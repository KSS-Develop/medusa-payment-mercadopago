import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MERCADOPAGO_CONEXION } from "../../../../modules/mercadopago-conexion"
import type MercadoPagoConexionService from "../../../../modules/mercadopago-conexion/service"
import { origenBackend } from "../../../../lib/origen"

// Termina la conexión: el admin entrega lo que devolvió Mercado Pago y el backend guarda las llaves.
export const POST = async (req: MedusaRequest<{ estado?: unknown; sobre?: unknown }>, res: MedusaResponse) => {
  const { estado, sobre } = req.body ?? {}
  if (typeof estado !== "string" || typeof sobre !== "string" || sobre.length > 8192) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "estado o sobre inválidos")
  }
  const s = req.scope.resolve<MercadoPagoConexionService>(MERCADOPAGO_CONEXION)
  res.json({ conexion: await s.canjear(estado, sobre, origenBackend(req)) })
}
