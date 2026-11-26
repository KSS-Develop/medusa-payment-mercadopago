// Lógica sin React: elegir la sesión de Mercado Pago, asegurarla y completar el carro al volver.

import type {
  CarroMercadoPago,
  MercadoPagoPaymentSdk,
  MercadoPagoSdk,
  PedidoMercadoPago,
  ResultadoRetorno,
  SesionDePago,
} from "./tipos.js"

export const PREFIJO_PROVEEDOR = "pp_mercadopago_"

// Estados de Mercado Pago que significan que el pago no se hará con esta sesión.
const ESTADOS_RECHAZADOS = new Set(["rejected", "cancelled", "refunded", "charged_back"])
// Estados de sesión de Medusa sin vuelta atrás para este intento.
const SESIONES_FALLIDAS = new Set(["error", "canceled"])

// Campos del carro que bastan para saber cómo quedó la sesión de pago.
export const CAMPOS_ESTADO_CARRO = "id,completed_at,*payment_collection,*payment_collection.payment_sessions"

export function isMercadoPago(providerId: string | null | undefined): boolean {
  return typeof providerId === "string" && providerId.startsWith(PREFIJO_PROVEEDOR)
}

function sesiones(cart: CarroMercadoPago | null | undefined): SesionDePago[] {
  return cart?.payment_collection?.payment_sessions ?? []
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined
}

// Sesión de Mercado Pago del carro: la del proveedor pedido (o la primera de Mercado Pago),
// prefiriendo una vigente ("pending").
export function getMercadoPagoSession(
  cart: CarroMercadoPago | null | undefined,
  providerId?: string
): SesionDePago | undefined {
  const candidatas = sesiones(cart).filter((s) =>
    providerId ? s.provider_id === providerId : isMercadoPago(s.provider_id)
  )
  return candidatas.find((s) => s.status === "pending") ?? candidatas[0]
}

// Sólo se acepta https: la URL viene de la sesión y se usa para redirigir al comprador.
function urlSegura(v: unknown): string | undefined {
  const url = texto(v)
  if (!url) return undefined
  try {
    return new URL(url).protocol === "https:" ? url : undefined
  } catch {
    return undefined
  }
}

// URL de Checkout Pro de la sesión de Mercado Pago del carro, si la hay.
export function getApprovalUrl(cart: CarroMercadoPago | null | undefined, providerId?: string): string | undefined {
  return urlSegura(getMercadoPagoSession(cart, providerId)?.data?.approval_url)
}

function mismoMonto(a: number | null | undefined, b: number | null | undefined): boolean {
  if (typeof a !== "number" || typeof b !== "number") return true // sin dato no se puede comparar
  return Math.abs(a - b) < 1e-6
}

// ¿Se puede reutilizar la sesión? Debe estar vigente, traer su URL y cobrar el total actual del carro.
function sesionReutilizable(cart: CarroMercadoPago, sesion: SesionDePago | undefined): boolean {
  if (!sesion || sesion.status !== "pending" || !urlSegura(sesion.data?.approval_url)) return false
  // Con un pago en curso (p. ej. un cupón de efectivo emitido) se reutiliza igual: crear otra sesión
  // vencería esa preferencia.
  const moneda = cart.currency_code?.toLowerCase()
  if (moneda && sesion.currency_code && sesion.currency_code.toLowerCase() !== moneda) return false
  return mismoMonto(sesion.amount, cart.total) && mismoMonto(sesion.amount, cart.payment_collection?.amount)
}

// Proveedor de Mercado Pago a usar: el pedido o el de la primera sesión de Mercado Pago del carro.
export function resolveMercadoPagoProvider(cart: CarroMercadoPago, providerId?: string): string | undefined {
  if (providerId) return providerId
  return sesiones(cart).find((s) => isMercadoPago(s.provider_id))?.provider_id
}

export class MercadoPagoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MercadoPagoError"
  }
}

// Asegura una sesión de Mercado Pago vigente por el total del carro y devuelve su URL de Checkout Pro.
// Reutiliza la existente si sirve; si no (no existe, cambió el monto, fue rechazada), crea una nueva.
export async function ensureMercadoPagoSession({
  cart,
  sdk,
  providerId,
}: {
  cart: CarroMercadoPago
  sdk: MercadoPagoPaymentSdk
  providerId?: string
}): Promise<{ approvalUrl: string; providerId: string; session: SesionDePago }> {
  const proveedor = resolveMercadoPagoProvider(cart, providerId)
  if (!proveedor || !isMercadoPago(proveedor)) {
    throw new MercadoPagoError("El carro no tiene Mercado Pago como medio de pago.")
  }
  const actual = getMercadoPagoSession(cart, proveedor)
  if (actual && sesionReutilizable(cart, actual)) {
    return { approvalUrl: urlSegura(actual.data?.approval_url)!, providerId: proveedor, session: actual }
  }
  const { payment_collection } = await sdk.store.payment.initiatePaymentSession(cart, { provider_id: proveedor })
  const nueva = getMercadoPagoSession({ id: cart.id, payment_collection }, proveedor)
  const url = urlSegura(nueva?.data?.approval_url)
  if (!nueva || !url) throw new MercadoPagoError("Mercado Pago no entregó la dirección de pago.")
  return { approvalUrl: url, providerId: proveedor, session: nueva }
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function mensajeDe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === "object" && e && "message" in e) return String((e as { message: unknown }).message)
  return ""
}

type Estado =
  | { tipo: "pendiente"; paymentStatus?: string; paymentStatusDetail?: string }
  | { tipo: "rechazado"; paymentStatus?: string }
  | { tipo: "sin-sesion" }
  | { tipo: "desconocido" }

// Cómo quedó la sesión de Mercado Pago del carro tras un intento fallido de completarlo.
function estadoDelCarro(cart: CarroMercadoPago | null | undefined): Estado {
  if (!cart?.payment_collection) return { tipo: "desconocido" }
  const sesion = getMercadoPagoSession(cart)
  if (!sesion) return { tipo: "sin-sesion" }
  const paymentStatus = texto(sesion.data?.status)
  if ((paymentStatus && ESTADOS_RECHAZADOS.has(paymentStatus)) || SESIONES_FALLIDAS.has(sesion.status ?? "")) {
    return { tipo: "rechazado", paymentStatus }
  }
  return { tipo: "pendiente", paymentStatus, paymentStatusDetail: texto(sesion.data?.status_detail) }
}

// Completa el carro al volver de Mercado Pago.
//
// Si el pago todavía no figura aprobado (efectivo, o Mercado Pago aún no lo informa), Medusa no completa
// el carro: se reintenta `attempts` veces esperando `delayMs` entre intentos. Si sigue pendiente devuelve
// `{ type: "pending" }` y el carro queda intacto; el webhook del backend lo completará cuando el pago se
// acredite. Un pago rechazado devuelve `{ type: "error", reason: "rejected" }` sin agotar los intentos.
export async function completeMercadoPagoReturn<P extends PedidoMercadoPago = PedidoMercadoPago>({
  sdk,
  cartId,
  attempts = 5,
  delayMs = 2500,
}: {
  sdk: MercadoPagoSdk<P>
  cartId: string
  attempts?: number
  delayMs?: number
}): Promise<ResultadoRetorno<P>> {
  if (!cartId) return { type: "error", reason: "failed", message: "No se encontró el carro." }
  const intentos = Math.max(1, Math.floor(attempts))
  let ultimo: Estado = { tipo: "desconocido" }
  let mensaje = ""

  for (let i = 0; i < intentos; i++) {
    if (i > 0 && delayMs > 0) await esperar(delayMs)
    let carro: CarroMercadoPago | null | undefined
    try {
      const r = await sdk.store.cart.complete(cartId)
      if (r.type === "order") return { type: "order", order: r.order }
      mensaje = r.error?.message ?? mensaje
      carro = r.cart
    } catch (e) {
      // Un pago aún no autorizado responde 400; 409 si el webhook está completando el mismo carro.
      mensaje = mensajeDe(e) || mensaje
    }
    if (!carro?.payment_collection && sdk.store.cart.retrieve) {
      try {
        carro = (await sdk.store.cart.retrieve(cartId, { fields: CAMPOS_ESTADO_CARRO })).cart
      } catch {
        carro = undefined
      }
    }
    ultimo = estadoDelCarro(carro)
    if (ultimo.tipo === "rechazado") {
      return { type: "error", reason: "rejected", message: "Mercado Pago rechazó el pago." }
    }
    if (ultimo.tipo === "sin-sesion") {
      return { type: "error", reason: "failed", message: "El carro no tiene un pago de Mercado Pago." }
    }
  }

  if (ultimo.tipo === "pendiente") {
    return {
      type: "pending",
      ...(ultimo.paymentStatus ? { paymentStatus: ultimo.paymentStatus } : {}),
      ...(ultimo.paymentStatusDetail ? { paymentStatusDetail: ultimo.paymentStatusDetail } : {}),
    }
  }
  // Sin poder leer el carro no se distingue pendiente de error: se informa como pendiente, que no
  // pierde el carro y deja al webhook terminar; el mensaje queda para quien quiera mostrarlo.
  if (!sdk.store.cart.retrieve) return { type: "pending" }
  return { type: "error", reason: "failed", message: mensaje || "No se pudo completar el pedido." }
}
