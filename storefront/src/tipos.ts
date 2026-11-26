// Tipos mínimos del carro y del SDK de Medusa que usa este paquete.
//
// Son estructurales a propósito: aceptan el `HttpTypes.StoreCart` y la instancia de `@medusajs/js-sdk`
// tal cual, y también un adaptador propio (por ejemplo, server actions del starter de Next.js, que leen
// las cookies del comprador y revalidan la caché).

export interface SesionDePago {
  id?: string
  provider_id: string
  amount?: number | null
  currency_code?: string | null
  status?: string | null
  data?: Record<string, unknown> | null
}

export interface ColeccionDePago {
  id?: string
  amount?: number | null
  currency_code?: string | null
  payment_sessions?: SesionDePago[] | null
}

export interface CarroMercadoPago {
  id: string
  total?: number | null
  currency_code?: string | null
  completed_at?: string | Date | null
  payment_collection?: ColeccionDePago | null
}

export interface PedidoMercadoPago {
  id: string
}

// Respuesta de POST /store/carts/:id/complete. Con `type: "cart"` el carro no se completó y `error`
// explica por qué (Medusa responde así a PAYMENT_AUTHORIZATION_ERROR y PAYMENT_REQUIRES_MORE_ERROR).
export type RespuestaCompletar<P extends PedidoMercadoPago = PedidoMercadoPago> =
  | { type: "order"; order: P }
  | {
      type: "cart"
      cart?: CarroMercadoPago | null
      error?: { message?: string; name?: string; type?: string } | null
    }

// La parte del SDK que se usa. Los métodos van con sintaxis de método para que TypeScript acepte
// la instancia real del SDK (cuyos parámetros son tipos más amplios).
export interface MercadoPagoSdk<P extends PedidoMercadoPago = PedidoMercadoPago> {
  store: {
    payment: {
      initiatePaymentSession(
        cart: CarroMercadoPago,
        body: { provider_id: string; data?: Record<string, unknown> }
      ): Promise<{ payment_collection: ColeccionDePago }>
    }
    cart: {
      complete(cartId: string): Promise<RespuestaCompletar<P>>
      // Opcional: si existe, se consulta el carro tras un intento fallido para distinguir un pago
      // pendiente de uno rechazado.
      retrieve?(cartId: string, query?: { fields?: string }): Promise<{ cart: CarroMercadoPago }>
    }
  }
}

// Lo que necesita el botón: sólo crear la sesión de pago.
export interface MercadoPagoPaymentSdk {
  store: { payment: MercadoPagoSdk["store"]["payment"] }
}

export type ResultadoRetorno<P extends PedidoMercadoPago = PedidoMercadoPago> =
  | { type: "order"; order: P }
  | {
      type: "pending"
      // Estado y detalle de Mercado Pago, si ya hay un pago (p. ej. "pending" / "pending_waiting_payment"
      // en efectivo). Sin pago registrado todavía, quedan vacíos.
      paymentStatus?: string
      paymentStatusDetail?: string
    }
  | {
      type: "error"
      message: string
      // "rejected": Mercado Pago rechazó o anuló el pago; el comprador puede volver a pagar.
      // "failed": el carro no se pudo completar por otro motivo.
      reason: "rejected" | "failed"
    }
