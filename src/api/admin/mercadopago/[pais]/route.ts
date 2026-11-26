import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MERCADOPAGO_CONEXION } from "../../../../modules/mercadopago-conexion"
import type MercadoPagoConexionService from "../../../../modules/mercadopago-conexion/service"

// Desconecta la cuenta de Mercado Pago de un país.
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const s = req.scope.resolve<MercadoPagoConexionService>(MERCADOPAGO_CONEXION)
  await s.desconectar(String(req.params.pais).toUpperCase())
  res.json({ pais: req.params.pais, conectada: false })
}
