import { model } from "@medusajs/framework/utils"

// Una cuenta de Mercado Pago conectada por país. Las llaves van cifradas.
const MercadoPagoConexion = model.define("mercadopago_conexion", {
  id: model.id({ prefix: "mpcon" }).primaryKey(),
  pais: model.text().unique(),
  user_id: model.text().nullable(),
  access_token: model.text().nullable(),
  refresh_token: model.text().nullable(),
  // Sello del intermediario que autoriza renovar con este refresh_token.
  sello: model.text().nullable(),
  public_key: model.text().nullable(),
  expira_en: model.dateTime().nullable(),
  live_mode: model.boolean().default(true),
  origen: model.text().nullable(),
  pendiente_estado: model.text().nullable(),
  pendiente_verificador: model.text().nullable(),
  pendiente_hasta: model.dateTime().nullable(),
})

export default MercadoPagoConexion
