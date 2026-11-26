// Proveedor de pago Mercado Pago (Checkout Pro) para Medusa v2.
// Se registra una vez por país (id "cl", "br", "ar"), cada uno con las credenciales de su cuenta.
// Flujo: initiatePayment crea una preferencia y entrega su URL (approval_url); el comprador paga en
// Mercado Pago y vuelve; authorizePayment busca el pago por external_reference (= id de la sesión) y
// verifica monto y moneda; el webhook firmado confirma el cobro aunque el comprador no vuelva.
import { randomUUID } from "node:crypto"
import { AbstractPaymentProvider, BigNumber, MedusaError, PaymentActions, defaultCurrencies } from "@medusajs/framework/utils"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  Logger,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import { MercadoPagoConfig, MerchantOrder, Payment, PaymentRefund, Preference } from "mercadopago"
import type { PaymentResponse } from "mercadopago/dist/clients/payment/commonTypes"
import type { PreferenceRequest } from "mercadopago/dist/clients/preference/commonTypes"
import { accionWebhook, estadoSesion, pagoVigente } from "../../lib/estado"
import { firmaValida } from "../../lib/firma"
import { iguales, redondear } from "../../lib/monto"
import { INTEGRATOR_ID_IA_ERP, PAISES, esPais, type Pais } from "../../lib/pais"
import { registro } from "../../lib/registro"

type InjectedDependencies = { logger: Logger }

export type Options = {
  // País de la cuenta de Mercado Pago: AR, BR, CL, CO, MX, PE o UY.
  country: Pais
  // Access Token de producción de la cuenta del vendedor (empieza con APP_USR-). Opcional: sin él se usa la cuenta
  // conectada con «Conectar con Mercado Pago» (módulo mercadopagoConexion).
  access_token?: string
  // Clave secreta de webhooks de la aplicación (panel → Webhooks), para verificar x-signature. Con la cuenta conectada
  // no existe (los avisos los firma la aplicación de IA ERP): el pago se vuelve a leer siempre desde la API.
  webhook_secret?: string
  // Páginas del storefront a las que vuelve el comprador. {session_id} se reemplaza por el id de la sesión.
  return_url: string
  failure_url?: string
  pending_url?: string
  // Opcional: URL del webhook de Medusa enviada en cada preferencia. Lo recomendado es configurarla en el
  // panel de la aplicación (avisos firmados): https://<backend>/hooks/payment/mercadopago_<id> (sin "pp_").
  notification_url?: string
  // Texto del cargo en el estado de cuenta de la tarjeta.
  statement_descriptor?: string
  // Máximo de cuotas ofrecidas (Checkout Pro).
  max_installments?: number
  // Medios excluidos, por ejemplo ["visa"] o tipos ["ticket"].
  excluded_payment_methods?: string[]
  excluded_payment_types?: string[]
  // Integrator ID del Partners Program. Por omisión, el de IA ERP.
  integrator_id?: string
}

// Lo que queda guardado en la sesión y el pago de Medusa. Visible para el storefront: sin secretos.
type Datos = {
  session_id?: string
  preference_id?: string
  approval_url?: string
  currency_code?: string
  amount?: number
  payment_id?: string
  status?: string
  status_detail?: string
  refund_id?: string
}

type Sdk = {
  preferencias: Preference
  pagos: Payment
  reembolsos: PaymentRefund
  ordenes: MerchantOrder
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined
}

function numero(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function leerDatos(data: Record<string, unknown> | undefined): Datos {
  const d = data ?? {}
  return {
    session_id: texto(d.session_id),
    preference_id: texto(d.preference_id),
    approval_url: texto(d.approval_url),
    currency_code: texto(d.currency_code),
    amount: numero(d.amount),
    payment_id: texto(d.payment_id),
    status: texto(d.status),
    status_detail: texto(d.status_detail),
    refund_id: texto(d.refund_id),
  }
}

function conSesion(url: string, sesion: string): string {
  return url.split("{session_id}").join(encodeURIComponent(sesion))
}

// Sólo avisos del webhook nuevo: sin IPN duplicado en formato viejo.
function soloWebhooks(url: string): string {
  return url.includes("source_news=") ? url : `${url}${url.includes("?") ? "&" : "?"}source_news=webhooks`
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

class MercadoPagoProviderService extends AbstractPaymentProvider<Options> {
  static identifier = "mercadopago"

  protected logger_: Logger
  protected options_: Options
  protected vistos_ = new Map<string, number>()

  static validateOptions(options: Record<string, unknown>): void {
    const faltan = ["country", "return_url"].filter((k) => !texto(options[k]))
    if (faltan.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Mercado Pago: faltan opciones ${faltan.join(", ")}`)
    }
    if (!esPais(String(options.country))) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Mercado Pago: country debe ser uno de ${Object.keys(PAISES).join(", ")}`)
    }
  }

  constructor(container: InjectedDependencies, options: Options) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = { max_installments: 12, integrator_id: INTEGRATOR_ID_IA_ERP, ...options }
    if (options.access_token && !options.webhook_secret) {
      this.logger_.warn(`Mercado Pago ${options.country}: sin webhook_secret no se verifica la firma de los avisos`)
    }
  }

  // Cliente nuevo por operación: el SDK guarda las opciones de cada llamada (incluida la llave de
  // idempotencia) en la configuración compartida, y reutilizarla mezclaría llaves entre operaciones.
  protected async sdk(): Promise<Sdk> {
    const config = new MercadoPagoConfig({
      accessToken: await this.llave(),
      options: { integratorId: this.options_.integrator_id, timeout: 15000 },
    })
    return {
      preferencias: new Preference(config),
      pagos: new Payment(config),
      reembolsos: new PaymentRefund(config),
      ordenes: new MerchantOrder(config),
    }
  }

  // Llave del vendedor: la de la configuración o la de la cuenta conectada desde el admin.
  private async llave(): Promise<string> {
    if (this.options_.access_token) return this.options_.access_token
    const c = await registro.fuente?.credenciales(this.options_.country)
    if (!c) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Mercado Pago ${this.options_.country} no está conectado: Configuración → Mercado Pago → Conectar con Mercado Pago`
      )
    }
    return c.access_token
  }

  // URL del webhook en cada preferencia: la configurada o, con la cuenta conectada, la del backend que la conectó.
  private async avisos(): Promise<string | undefined> {
    if (this.options_.notification_url) return soloWebhooks(this.options_.notification_url)
    if (this.options_.access_token) return undefined
    const c = await registro.fuente?.credenciales(this.options_.country)
    return c?.origen ? soloWebhooks(`${c.origen}/hooks/payment/mercadopago_${this.options_.country.toLowerCase()}`) : undefined
  }

  private moneda(): string {
    return PAISES[this.options_.country].moneda
  }

  private decimales(moneda: string): number {
    const d = defaultCurrencies[moneda.toUpperCase()]?.decimal_digits
    if (d === undefined) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Moneda desconocida: ${moneda}`)
    return d
  }

  private monto(valor: InitiatePaymentInput["amount"], moneda: string): number {
    return redondear(new BigNumber(valor).numeric, this.decimales(moneda))
  }

  private comprobarMoneda(moneda: string): void {
    if (moneda.toLowerCase() !== this.moneda()) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Mercado Pago ${this.options_.country} cobra en ${this.moneda().toUpperCase()}, no en ${moneda.toUpperCase()}`
      )
    }
  }

  private item(sesion: string, monto: number, moneda: string) {
    return { id: sesion, title: "Pedido", quantity: 1, currency_id: moneda.toUpperCase(), unit_price: monto }
  }

  private preferencia(sesion: string, monto: number, moneda: string, avisos?: string): PreferenceRequest {
    const o = this.options_
    return {
      items: [this.item(sesion, monto, moneda)],
      external_reference: sesion,
      metadata: { session_id: sesion },
      notification_url: avisos,
      back_urls: {
        success: conSesion(o.return_url, sesion),
        failure: conSesion(o.failure_url ?? o.return_url, sesion),
        pending: conSesion(o.pending_url ?? o.return_url, sesion),
      },
      // Mercado Pago sólo acepta la vuelta automática con páginas https (en desarrollo local se omite).
      auto_return: o.return_url.startsWith("https://") ? "approved" : undefined,
      statement_descriptor: o.statement_descriptor,
      payment_methods: {
        installments: o.max_installments,
        excluded_payment_methods: (o.excluded_payment_methods ?? []).map((id) => ({ id })),
        excluded_payment_types: (o.excluded_payment_types ?? []).map((id) => ({ id })),
      },
    }
  }

  // Pagos de una sesión: primero por external_reference; si la búsqueda (que tarda en ponerse al día)
  // no trae nada, por la orden de la preferencia. Prefiere un pago vigente; si no, el más reciente.
  protected async pagoDeSesion(d: Datos, reintentar = true): Promise<PaymentResponse | undefined> {
    if (!d.session_id) return undefined
    const { pagos, ordenes } = (await this.sdk())
    const ids: string[] = []
    for (let intento = 0; intento < (reintentar ? 2 : 1) && !ids.length; intento++) {
      if (intento) await espera(1500)
      const r = await pagos.search({
        options: { external_reference: d.session_id, sort: "date_created", criteria: "desc", limit: 20 },
      })
      for (const p of r.results ?? []) if (p.id !== undefined) ids.push(String(p.id))
      if (!ids.length && d.preference_id) {
        const o = await ordenes.search({ options: { preference_id: d.preference_id } })
        for (const orden of o.elements ?? []) for (const p of orden.payments ?? []) if (p.id !== undefined) ids.push(String(p.id))
      }
    }
    let ultimo: PaymentResponse | undefined
    for (const id of ids.slice(0, 10)) {
      const pago = await pagos.get({ id })
      if (pago.external_reference && pago.external_reference !== d.session_id) continue
      if (pagoVigente(pago.status)) return pago
      ultimo ??= pago
    }
    return ultimo
  }

  // El pago guardado sólo se reutiliza si sigue vigente; si fue rechazado o anulado, el comprador pudo
  // reintentar con otro pago en la misma preferencia.
  private async pagoActual(d: Datos): Promise<PaymentResponse | undefined> {
    if (d.payment_id && pagoVigente(d.status)) {
      const pago = await (await this.sdk()).pagos.get({ id: d.payment_id })
      if (pagoVigente(pago.status)) return pago
    }
    return this.pagoDeSesion(d)
  }

  // ¿El pago corresponde a lo cobrado: misma moneda y el mismo monto (ya redondeados)?
  private pagoCuadra(d: Datos, pago: PaymentResponse): boolean {
    const moneda = d.currency_code ?? this.moneda()
    if ((pago.currency_id ?? "").toLowerCase() !== moneda) return false
    if (d.amount === undefined || pago.transaction_amount === undefined) return d.amount === undefined
    return iguales(pago.transaction_amount, d.amount, this.decimales(moneda))
  }

  private conPago(d: Datos, pago: PaymentResponse): Datos {
    return { ...d, payment_id: String(pago.id), status: pago.status, status_detail: pago.status_detail }
  }

  private envolver(e: unknown, contexto: string): MedusaError {
    const m =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e && "message" in e
          ? String((e as { message: unknown }).message)
          : ""
    return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Mercado Pago (${contexto}): ${m || "error"}`)
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sesion = texto(input.data?.session_id)
    if (!sesion) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Mercado Pago: falta session_id")
    const moneda = input.currency_code.toLowerCase()
    this.comprobarMoneda(moneda)
    const monto = this.monto(input.amount, moneda)
    try {
      const pref = await (await this.sdk()).preferencias.create({
        body: this.preferencia(sesion, monto, moneda, await this.avisos()),
        requestOptions: { idempotencyKey: input.context?.idempotency_key ?? sesion },
      })
      if (!pref.id || !pref.init_point) throw new Error("la preferencia no trae id o init_point")
      const datos: Datos = {
        session_id: sesion,
        preference_id: pref.id,
        approval_url: pref.init_point,
        currency_code: moneda,
        amount: monto,
        status: "pending",
      }
      // payment_id explícito en blanco: lo que mande el storefront en data no se toma como pago.
      return { id: pref.id, data: { ...datos, payment_id: undefined } }
    } catch (e) {
      throw this.envolver(e, "crear preferencia")
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const d = leerDatos(input.data)
    if (!d.preference_id || !d.session_id) return { data: input.data }
    const moneda = input.currency_code.toLowerCase()
    this.comprobarMoneda(moneda)
    const monto = this.monto(input.amount, moneda)
    // Con un pago ya aprobado no se cambia el precio de la preferencia, pero se guarda el monto nuevo
    // para que la autorización detecte que lo pagado ya no cuadra.
    if (d.payment_id && pagoVigente(d.status)) return { data: { ...input.data, ...d, amount: monto } }
    try {
      await (await this.sdk()).preferencias.update({
        id: d.preference_id,
        updatePreferenceRequest: { items: [this.item(d.session_id, monto, moneda)] },
        requestOptions: { idempotencyKey: randomUUID() },
      })
      return { data: { ...input.data, ...d, amount: monto } }
    } catch (e) {
      throw this.envolver(e, "actualizar preferencia")
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const d = leerDatos(input.data)
    if (!d.session_id) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Mercado Pago: falta session_id")
    try {
      const pago = await this.pagoActual(d)
      if (!pago) return { data: { ...d }, status: "pending" }
      const datos = this.conPago(d, pago)
      if (pagoVigente(pago.status) && !this.pagoCuadra(d, pago)) {
        this.logger_.warn(`Mercado Pago: el pago ${pago.id} no cuadra en monto o moneda con la sesión ${d.session_id}`)
        return { data: { ...datos, status_detail: "monto_o_moneda_distintos" }, status: "error" }
      }
      return { data: datos, status: estadoSesion(pago.status) }
    } catch (e) {
      throw this.envolver(e, "autorizar")
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const d = leerDatos(input.data)
    if (!d.payment_id || d.status !== "authorized") return { data: { ...d } }
    try {
      const pago = await (await this.sdk()).pagos.capture({
        id: d.payment_id,
        requestOptions: { idempotencyKey: input.context?.idempotency_key ?? `captura-${d.payment_id}` },
      })
      return { data: this.conPago(d, pago) }
    } catch (e) {
      throw this.envolver(e, "capturar")
    }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const d = leerDatos(input.data)
    // Un pago ya cobrado no se anula aquí: si Medusa no pudo crear el pedido, su propia compensación lo
    // reembolsa con refundPayment y deja el reembolso registrado.
    if (d.payment_id && d.status === "approved") {
      this.logger_.error(
        `Mercado Pago: Medusa anuló la sesión ${d.session_id} con el pago ${d.payment_id} cobrado; revisar si tiene pedido y si no, reembolsarlo`
      )
      return { data: { ...d } }
    }
    const cancelable = d.status === "pending" || d.status === "in_process" || d.status === "authorized"
    if (!d.payment_id || !cancelable) return { data: { ...d } }
    try {
      const pago = await (await this.sdk()).pagos.cancel({
        id: d.payment_id,
        requestOptions: { idempotencyKey: input.context?.idempotency_key ?? `anulacion-${d.payment_id}` },
      })
      return { data: this.conPago(d, pago) }
    } catch (e) {
      throw this.envolver(e, "anular")
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const d = leerDatos(input.data)
    if (!d.payment_id) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Mercado Pago: falta payment_id para reembolsar")
    const moneda = d.currency_code ?? this.moneda()
    let r
    try {
      r = await (await this.sdk()).reembolsos.create({
        payment_id: d.payment_id,
        body: { amount: this.monto(input.amount, moneda) },
        requestOptions: { idempotencyKey: input.context?.idempotency_key ?? randomUUID() },
      })
    } catch (e) {
      throw this.envolver(e, "reembolsar")
    }
    if (r.status === "rejected" || r.status === "cancelled") {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Mercado Pago rechazó el reembolso del pago ${d.payment_id}`)
    }
    return { data: { ...d, refund_id: r.id !== undefined ? String(r.id) : d.refund_id } }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    // Medusa borra la sesión cuando cambia el carro: primero se vence la preferencia, para que una pestaña
    // vieja no cobre un monto que ya no corresponde. Nada de esto interrumpe el carro.
    const d = leerDatos(input.data)
    const cobrada = d.payment_id && pagoVigente(d.status) && d.status_detail !== "monto_o_moneda_distintos"
    if (!d.preference_id || cobrada) return { data: input.data }
    try {
      await (await this.sdk()).preferencias.update({
        id: d.preference_id,
        // La API acepta actualizaciones parciales; el tipo del SDK exige items sin necesitarlos.
        updatePreferenceRequest: { expires: true, expiration_date_to: new Date().toISOString() } as PreferenceRequest,
        requestOptions: { idempotencyKey: randomUUID() },
      })
    } catch (e) {
      this.logger_.warn(`Mercado Pago: no se pudo vencer la preferencia ${d.preference_id} (${e instanceof Error ? e.message : "error"})`)
    }
    // Si el comprador alcanzó a pagar, ese cobro queda sin pedido. No se reembolsa solo (podría cruzarse con
    // un pedido que se está creando): se deja un error en el log para revisarlo y devolverlo desde el panel.
    try {
      const pago = await this.pagoDeSesion(d, false)
      if (pago?.id !== undefined && pagoVigente(pago.status)) {
        this.logger_.error(
          `Mercado Pago: el pago ${pago.id} de la sesión borrada ${d.session_id} está cobrado; revisar si tiene pedido y si no, reembolsarlo`
        )
      }
    } catch {
      // Sólo diagnóstico.
    }
    return { data: input.data }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const d = leerDatos(input.data)
    if (!d.payment_id) return { data: { ...d } }
    try {
      const pago = await (await this.sdk()).pagos.get({ id: d.payment_id })
      return {
        data: {
          ...this.conPago(d, pago),
          transaction_amount: pago.transaction_amount,
          currency_id: pago.currency_id,
          payment_method_id: pago.payment_method_id,
          installments: pago.installments,
          date_approved: pago.date_approved,
        },
      }
    } catch (e) {
      throw this.envolver(e, "consultar pago")
    }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const d = leerDatos(input.data)
    try {
      const pago = await this.pagoActual(d)
      if (!pago) return { status: "pending", data: { ...d } }
      if (pagoVigente(pago.status) && !this.pagoCuadra(d, pago)) return { status: "error", data: this.conPago(d, pago) }
      return { status: estadoSesion(pago.status), data: this.conPago(d, pago) }
    } catch (e) {
      this.logger_.warn(`Mercado Pago: no se pudo consultar el estado (${e instanceof Error ? e.message : "error"})`)
      return { status: "pending", data: { ...d } }
    }
  }

  async getWebhookActionAndData(payload: ProviderWebhookPayload["payload"]): Promise<WebhookActionResult> {
    const cuerpo = (payload.data ?? {}) as { type?: string; topic?: string; data?: { id?: string | number } }
    const tipo = cuerpo.type ?? cuerpo.topic
    const dataId = cuerpo.data?.id !== undefined ? String(cuerpo.data.id) : undefined
    // merchant_order, avisos IPN viejos y otros tópicos no traen data.id de un pago: se ignoran sin ruido.
    if (tipo !== "payment" || !dataId || !/^\d{1,20}$/.test(dataId)) return { action: PaymentActions.NOT_SUPPORTED }
    // La clave puede venir de la configuración o de la aplicación propia guardada en el admin.
    let secretoFirma = this.options_.webhook_secret
    if (!secretoFirma && !this.options_.access_token) {
      try {
        secretoFirma = (await registro.fuente?.credenciales(this.options_.country))?.webhook_secret
      } catch (e) {
        // Sin poder leer las llaves guardadas no se acepta el aviso (el pago se confirmará al volver el comprador).
        this.logger_.warn(`Mercado Pago: aviso del pago ${dataId} ignorado (${e instanceof Error ? e.message : "error"})`)
        return { action: PaymentActions.NOT_SUPPORTED }
      }
    }
    // Sin firma (cuenta conectada) se limita la relectura: el mismo aviso (pago + acción) se atiende una vez cada 2 s.
    const clave = `${dataId}:${(cuerpo as { action?: string }).action ?? ""}`
    if (!secretoFirma && (this.vistos_.get(clave) ?? 0) > Date.now()) {
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    const encabezado = (n: string): string | undefined => {
      const v = payload.headers?.[n]
      return Array.isArray(v) ? v[0] : typeof v === "string" ? v : undefined
    }
    // Con webhook_secret se exige la firma. Sin él (cuenta conectada) no hay secreto propio que verificar: el aviso
    // sólo sirve de señal y el pago, su sesión y su monto se leen siempre de la API con la llave del vendedor.
    const ok =
      !secretoFirma ||
      firmaValida({
        secreto: secretoFirma,
        encabezado: encabezado("x-signature"),
        requestId: encabezado("x-request-id"),
        dataId,
      })
    if (!ok) {
      this.logger_.warn(`Mercado Pago: webhook del pago ${dataId} con firma inválida; se ignora`)
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    let pago: PaymentResponse
    try {
      pago = await (await this.sdk()).pagos.get({ id: dataId })
      if (!secretoFirma) {
        const ahora = Date.now()
        this.vistos_.set(clave, ahora + 2_000)
        if (this.vistos_.size > 5000) for (const [k, v] of this.vistos_) if (v < ahora) this.vistos_.delete(k)
      }
    } catch (e) {
      this.logger_.warn(`Mercado Pago: no se pudo leer el pago ${dataId} (${e instanceof Error ? e.message : "error"})`)
      return { action: PaymentActions.NOT_SUPPORTED }
    }
    const sesion =
      texto(pago.external_reference) ?? texto((pago.metadata as Record<string, unknown> | undefined)?.session_id)
    if (!sesion || pago.transaction_amount === undefined) return { action: PaymentActions.NOT_SUPPORTED }
    const datos = { session_id: sesion, amount: new BigNumber(pago.transaction_amount) }
    switch (accionWebhook(pago.status)) {
      case "captured":
        return { action: PaymentActions.SUCCESSFUL, data: datos }
      case "authorized":
        return { action: PaymentActions.AUTHORIZED, data: datos }
      case "canceled":
        return { action: PaymentActions.CANCELED, data: datos }
      case "failed":
        return { action: PaymentActions.FAILED, data: datos }
      default:
        return { action: PaymentActions.NOT_SUPPORTED }
    }
  }
}

export default MercadoPagoProviderService
