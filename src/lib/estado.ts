// Traducción de los estados de un pago de Mercado Pago a los de Medusa.
// https://www.mercadopago.cl/developers/es/reference/payments/_payments_id/get (campo status)

export type EstadoSesion = "authorized" | "captured" | "pending" | "canceled" | "error"
export type AccionWebhook = "authorized" | "captured" | "canceled" | "failed" | "not_supported"

// Estado de un pago de Mercado Pago → estado de la sesión de pago de Medusa.
// Checkout Pro cobra de inmediato: "approved" ya es dinero capturado. Un pago reembolsado o con
// contracargo nunca debe completar un carro: cuenta como error.
export function estadoSesion(estado: string | undefined): EstadoSesion {
  switch (estado) {
    case "approved":
      return "captured"
    case "authorized":
      return "authorized"
    case "cancelled":
      return "canceled"
    case "rejected":
    case "refunded":
    case "charged_back":
      return "error"
    default:
      // pending, in_process, in_mediation o sin pago todavía
      return "pending"
  }
}

// Un pago que sirve para completar el carro.
export function pagoVigente(estado: string | undefined): boolean {
  return estado === "approved" || estado === "authorized"
}

// Estado de un pago → acción del webhook. Sólo "authorized" y "captured" mueven a Medusa;
// rechazos y anulaciones se informan con su acción correcta igual.
export function accionWebhook(estado: string | undefined): AccionWebhook {
  switch (estado) {
    case "approved":
      return "captured"
    case "authorized":
      return "authorized"
    case "cancelled":
      return "canceled"
    case "rejected":
      return "failed"
    default:
      return "not_supported"
  }
}
