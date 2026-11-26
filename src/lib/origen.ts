import type { MedusaRequest } from "@medusajs/framework/http"

// Origen público del backend, al que Mercado Pago envía los avisos de pago. Se calcula en el servidor:
// MEDUSA_BACKEND_URL si está definida o, si no, el host de esta petición.
export function origenBackend(req: MedusaRequest): string {
  const conf = process.env.MEDUSA_BACKEND_URL
  if (conf && URL.canParse(conf)) return new URL(conf).origin
  const p = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim()
  const proto = p === "http" ? "http" : "https"
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim()
  return `${proto}://${host}`
}

export function urlWebhook(origen: string, pais: string): string {
  return `${origen}/hooks/payment/mercadopago_${pais.toLowerCase()}`
}
