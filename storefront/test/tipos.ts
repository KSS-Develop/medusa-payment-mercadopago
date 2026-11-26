// Comprobación de tipos (no se ejecuta): la instancia real de @medusajs/js-sdk y los tipos de
// HttpTypes deben servir tal cual en la API pública.
import Medusa from "@medusajs/js-sdk"
import type { HttpTypes } from "@medusajs/types"
import {
  completeMercadoPagoReturn,
  ensureMercadoPagoSession,
  getApprovalUrl,
  MercadoPagoPaymentButton,
  MercadoPagoReturn,
  type MercadoPagoSdk,
} from "../src/index.js"

const sdk = new Medusa({ baseUrl: "http://localhost:9000", publishableKey: "pk_prueba" })
declare const cart: HttpTypes.StoreCart

export const conSdk: MercadoPagoSdk<HttpTypes.StoreOrder> = sdk
export const url: string | undefined = getApprovalUrl(cart)
export const sesion = ensureMercadoPagoSession({ cart, sdk })

export async function pedido() {
  const r = await completeMercadoPagoReturn({ sdk, cartId: cart.id })
  // El pedido conserva el tipo StoreOrder inferido del SDK.
  if (r.type === "order") return r.order.display_id
  return null
}

export const boton = MercadoPagoPaymentButton({ cart, sdk })
export const retorno = MercadoPagoReturn({ sdk, cartId: cart.id, onOrder: (o) => o.display_id })
