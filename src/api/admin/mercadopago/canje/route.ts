import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MERCADOPAGO_CONEXION } from "../../../../modules/mercadopago-conexion"
import type MercadoPagoConexionService from "../../../../modules/mercadopago-conexion/service"

// Origen público del backend, al que Mercado Pago enviará los avisos de pago. Se calcula en el servidor:
// MEDUSA_BACKEND_URL si está definida o, si no, el host de esta petición.
function origenBackend(req: MedusaRequest): string {
  const conf = process.env.MEDUSA_BACKEND_URL
  if (conf && URL.canParse(conf)) return new URL(conf).origin
  const p = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim()
  const proto = p === "http" ? "http" : "https"
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim()
  return `${proto}://${host}`
}

// Termina la conexión: el admin entrega lo que devolvió Mercado Pago y el backend guarda las llaves.
export const POST = async (req: MedusaRequest<{ estado?: unknown; sobre?: unknown }>, res: MedusaResponse) => {
  const { estado, sobre } = req.body ?? {}
  if (typeof estado !== "string" || typeof sobre !== "string" || sobre.length > 8192) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "estado o sobre inválidos")
  }
  const s = req.scope.resolve<MercadoPagoConexionService>(MERCADOPAGO_CONEXION)
  res.json({ conexion: await s.canjear(estado, sobre, origenBackend(req)) })
}
