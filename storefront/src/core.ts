// Entrada sin React (`@ia-erp/medusa-mercadopago-storefront/core`): para server actions, rutas o
// cualquier código que no deba cargar componentes de cliente.
export {
  CAMPOS_ESTADO_CARRO,
  completeMercadoPagoReturn,
  ensureMercadoPagoSession,
  getApprovalUrl,
  getMercadoPagoSession,
  isMercadoPago,
  MercadoPagoError,
  PREFIJO_PROVEEDOR,
  resolveMercadoPagoProvider,
} from "./nucleo.js"
export type {
  CarroMercadoPago,
  ColeccionDePago,
  MercadoPagoPaymentSdk,
  MercadoPagoSdk,
  PedidoMercadoPago,
  RespuestaCompletar,
  ResultadoRetorno,
  SesionDePago,
} from "./tipos.js"
