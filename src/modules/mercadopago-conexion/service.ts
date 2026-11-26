// Conexiones OAuth con Mercado Pago («Conectar con Mercado Pago» en el admin de Medusa).
import { createHash, randomBytes } from "node:crypto"
import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import MercadoPagoConexion from "./models/conexion"
import { cifrar, claveDesde, descifrar } from "../../lib/cifrado"
import { esPais } from "../../lib/pais"
import { registro, type CredencialesActivas } from "../../lib/registro"

export type OpcionesConexion = {
  // Clave para cifrar las llaves en la base de datos. Por omisión la variable MP_CONEXION_CLAVE.
  clave_cifrado?: string
  // Intermediario OAuth de IA ERP (guarda el secreto de la aplicación en Mercado Pago).
  broker_url?: string
}

export const BROKER_IA_ERP = "https://ia-erp.cl/mercadopago/oauth"
const RENOVAR_ANTES_MS = 30 * 24 * 3600_000

export type EstadoConexion = {
  pais: string
  conectada: boolean
  user_id: string | null
  live_mode: boolean
  expira_en: Date | null
}

type Fila = {
  id: string
  pais: string
  user_id: string | null
  access_token: string | null
  refresh_token: string | null
  sello: string | null
  public_key: string | null
  expira_en: Date | null
  live_mode: boolean
  origen: string | null
  pendiente_estado: string | null
  pendiente_verificador: string | null
  pendiente_hasta: Date | null
}

type Tokens = {
  access_token: string
  refresh_token?: string
  public_key?: string
  user_id?: number | string
  expires_in?: number
  live_mode?: boolean
  sello?: string
}

class MercadoPagoConexionService extends MedusaService({ MercadoPagoConexion }) {
  protected clave_: Buffer
  protected broker_: string
  protected logger_: Logger
  protected cache_ = new Map<string, { valor: CredencialesActivas; hasta: number }>()
  protected enCurso_ = new Map<string, Promise<CredencialesActivas | null>>()
  protected conectables_?: { paises: string[]; hasta: number }

  constructor(container: { logger: Logger }, opciones: OpcionesConexion = {}) {
    // eslint-disable-next-line prefer-rest-params
    super(...arguments)
    this.logger_ = container.logger
    const secreto = opciones.clave_cifrado ?? process.env.MP_CONEXION_CLAVE
    if (!secreto || secreto.length < 24 || /^(supersecret|secret|changeme)$/i.test(secreto)) {
      throw new Error(
        "Mercado Pago: defina MP_CONEXION_CLAVE (al menos 24 caracteres aleatorios) para cifrar las llaves de las cuentas conectadas"
      )
    }
    this.clave_ = claveDesde(secreto)
    this.broker_ = (opciones.broker_url ?? BROKER_IA_ERP).replace(/\/$/, "")
    registro.fuente = this
  }

  private async fila(pais: string): Promise<Fila | undefined> {
    const [f] = (await this.listMercadoPagoConexions({ pais })) as unknown as Fila[]
    return f
  }

  // Países en que IA ERP tiene aplicación de Mercado Pago (se pueden conectar con un clic).
  async conectables(): Promise<string[]> {
    if (this.conectables_ && this.conectables_.hasta > Date.now()) return this.conectables_.paises
    try {
      const r = await fetch(`${this.broker_}/paises`, { signal: AbortSignal.timeout(5000) })
      const b = (await r.json()) as { paises?: string[] }
      const paises = Array.isArray(b.paises) ? b.paises : []
      this.conectables_ = { paises, hasta: Date.now() + 3600_000 }
      return paises
    } catch {
      return []
    }
  }

  async estados(): Promise<EstadoConexion[]> {
    const filas = (await this.listMercadoPagoConexions({})) as unknown as Fila[]
    return filas.map((f) => ({
      pais: f.pais,
      conectada: !!f.access_token,
      user_id: f.user_id,
      live_mode: f.live_mode,
      expira_en: f.expira_en,
    }))
  }

  // Paso 1: prepara la conexión y entrega la URL a la que el admin debe ir.
  async iniciar(pais: string, vuelta: string): Promise<string> {
    if (!esPais(pais)) throw new MedusaError(MedusaError.Types.INVALID_DATA, `País no soportado: ${pais}`)
    const u = new URL(vuelta)
    if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "El admin debe abrirse con https para conectar Mercado Pago")
    }
    const estado = randomBytes(24).toString("base64url")
    const verificador = randomBytes(32).toString("base64url")
    const desafio = createHash("sha256").update(verificador).digest("base64url")
    const datos = {
      pendiente_estado: estado,
      pendiente_verificador: cifrar(this.clave_, verificador),
      pendiente_hasta: new Date(Date.now() + 15 * 60_000),
    }
    const f = await this.fila(pais)
    if (f) await this.updateMercadoPagoConexions({ id: f.id, ...datos })
    else {
      try {
        await this.createMercadoPagoConexions({ pais, ...datos })
      } catch {
        // Otra conexión del mismo país se creó en paralelo: se actualiza esa.
        const g = await this.fila(pais)
        if (!g) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "No se pudo preparar la conexión")
        await this.updateMercadoPagoConexions({ id: g.id, ...datos })
      }
    }
    const inicio = new URL(`${this.broker_}/inicio`)
    inicio.searchParams.set("pais", pais)
    inicio.searchParams.set("vuelta", vuelta)
    inicio.searchParams.set("estado", estado)
    inicio.searchParams.set("desafio", desafio)
    return inicio.toString()
  }

  // Paso 2: el admin vuelve con el sobre cifrado; el backend lo canjea con su verificador y guarda las llaves.
  async canjear(estado: string, sobre: string, origen: string): Promise<EstadoConexion> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(estado)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "Estado inválido")
    const [f] = (await this.listMercadoPagoConexions({ pendiente_estado: estado })) as unknown as Fila[]
    if (!f || !f.pendiente_verificador || !f.pendiente_hasta || f.pendiente_hasta.getTime() < Date.now()) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "La conexión con Mercado Pago venció; inténtalo de nuevo")
    }
    const r = await fetch(`${this.broker_}/canje`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sobre, verificador: descifrar(this.clave_, f.pendiente_verificador) }),
    })
    const t = (await r.json().catch(() => ({}))) as Tokens & { pais?: string; error?: string }
    if (!r.ok || !t.access_token) {
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Mercado Pago no entregó las llaves (${t.error ?? r.status})`)
    }
    if (t.pais && t.pais !== f.pais) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "País de la conexión distinto")
    await this.guardarTokens(f, t, { origen, pendiente_estado: null, pendiente_verificador: null, pendiente_hasta: null })
    return (await this.estados()).find((e) => e.pais === f.pais)!
  }

  async desconectar(pais: string): Promise<void> {
    const f = await this.fila(pais)
    if (f) await this.deleteMercadoPagoConexions(f.id)
    this.cache_.delete(pais)
  }

  private async guardarTokens(f: Fila, t: Tokens, extra: Partial<Fila> = {}): Promise<void> {
    await this.updateMercadoPagoConexions({
      id: f.id,
      access_token: cifrar(this.clave_, t.access_token),
      refresh_token: t.refresh_token ? cifrar(this.clave_, t.refresh_token) : f.refresh_token,
      sello: t.sello ? cifrar(this.clave_, t.sello) : f.sello,
      public_key: t.public_key ?? f.public_key,
      user_id: t.user_id !== undefined ? String(t.user_id) : f.user_id,
      live_mode: t.live_mode ?? f.live_mode,
      expira_en: new Date(Date.now() + (t.expires_in ?? 15552000) * 1000),
      ...extra,
    })
    this.cache_.delete(f.pais)
  }

  // Lo usa el proveedor de pago. Renueva la llave cuando le quedan menos de 30 días; una sola renovación a la vez.
  async credenciales(pais: string): Promise<CredencialesActivas | null> {
    const c = this.cache_.get(pais)
    if (c && c.hasta > Date.now()) return c.valor
    const curso = this.enCurso_.get(pais)
    if (curso) return curso
    const p = this.leerCredenciales(pais).finally(() => this.enCurso_.delete(pais))
    this.enCurso_.set(pais, p)
    return p
  }

  private async leerCredenciales(pais: string): Promise<CredencialesActivas | null> {
    const f = await this.fila(pais)
    if (!f?.access_token) return null
    let access: string
    try {
      access = descifrar(this.clave_, f.access_token)
    } catch {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Mercado Pago ${pais}: no se pudieron leer las llaves guardadas (¿cambió MP_CONEXION_CLAVE?). Vuelva a conectar la cuenta.`
      )
    }
    if (f.refresh_token && f.sello && f.expira_en && f.expira_en.getTime() - Date.now() < RENOVAR_ANTES_MS) {
      access = (await this.renovar(f)) ?? access
    }
    const valor = { access_token: access, origen: f.origen ?? undefined }
    this.cache_.set(pais, { valor, hasta: Date.now() + 60_000 })
    return valor
  }

  private async renovar(f: Fila): Promise<string | null> {
    try {
      const r = await fetch(`${this.broker_}/renovar`, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pais: f.pais,
          refresh_token: descifrar(this.clave_, f.refresh_token!),
          sello: descifrar(this.clave_, f.sello!),
        }),
      })
      const t = (await r.json().catch(() => ({}))) as Tokens
      if (r.ok && t.access_token) {
        await this.guardarTokens(f, t)
        return t.access_token
      }
      // Otro proceso pudo renovar primero con el mismo refresh_token: se relee la fila.
      const g = await this.fila(f.pais)
      if (g?.access_token && g.access_token !== f.access_token) return descifrar(this.clave_, g.access_token)
      this.logger_.error(
        `Mercado Pago ${f.pais}: no se pudo renovar la llave (${r.status}); vence el ${f.expira_en?.toISOString().slice(0, 10)}. Vuelva a conectar la cuenta.`
      )
    } catch (e) {
      this.logger_.warn(`Mercado Pago ${f.pais}: no se pudo renovar la llave (${e instanceof Error ? e.message : "error"})`)
    }
    return null
  }
}

export default MercadoPagoConexionService
