import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MERCADOPAGO_CONEXION } from "../../../../modules/mercadopago-conexion"
import type MercadoPagoConexionService from "../../../../modules/mercadopago-conexion/service"
import { origenBackend } from "../../../../lib/origen"

// Guarda las llaves de la aplicación propia de la tienda (guía paso a paso del admin).
export const POST = async (
  req: MedusaRequest<{ pais?: unknown; access_token?: unknown; webhook_secret?: unknown }>,
  res: MedusaResponse
) => {
  const { pais, access_token, webhook_secret } = req.body ?? {}
  if (typeof pais !== "string" || typeof access_token !== "string" || typeof webhook_secret !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Faltan país, Access Token o clave secreta")
  }
  const s = req.scope.resolve<MercadoPagoConexionService>(MERCADOPAGO_CONEXION)
  res.json({
    conexion: await s.guardarPropias(pais.toUpperCase(), access_token.trim(), webhook_secret.trim(), origenBackend(req)),
  })
}
