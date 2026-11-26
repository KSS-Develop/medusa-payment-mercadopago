// Puente entre el módulo de conexiones (que guarda las llaves obtenidas con «Conectar con Mercado Pago») y el
// proveedor de pago. Los módulos de Medusa están aislados y el proveedor no puede resolver otro módulo, así que el
// servicio del módulo se registra aquí al construirse (una vez por proceso: servidor y worker).
export type CredencialesActivas = {
  access_token: string
  // Origen público del backend (https://…), para armar la URL del webhook de cada preferencia.
  origen?: string
}

export interface FuenteDeCredenciales {
  credenciales(pais: string): Promise<CredencialesActivas | null>
}

export const registro: { fuente?: FuenteDeCredenciales } = {}
