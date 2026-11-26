import { Module } from "@medusajs/framework/utils"
import MercadoPagoConexionService from "./service"

export const MERCADOPAGO_CONEXION = "mercadopagoConexion"

export default Module(MERCADOPAGO_CONEXION, {
  service: MercadoPagoConexionService,
})
