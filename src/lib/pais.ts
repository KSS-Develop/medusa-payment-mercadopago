// Datos de cada país de Mercado Pago soportado. El país sólo fija la moneda admitida y el sitio;
// los medios de pago los muestra Checkout Pro según la cuenta del vendedor.

export const PAISES = {
  AR: { site_id: "MLA", moneda: "ars" },
  BR: { site_id: "MLB", moneda: "brl" },
  CL: { site_id: "MLC", moneda: "clp" },
  CO: { site_id: "MCO", moneda: "cop" },
  MX: { site_id: "MLM", moneda: "mxn" },
  PE: { site_id: "MPE", moneda: "pen" },
  UY: { site_id: "MLU", moneda: "uyu" },
} as const

export type Pais = keyof typeof PAISES
export type DatosPais = (typeof PAISES)[Pais]

export function esPais(valor: string): valor is Pais {
  return Object.prototype.hasOwnProperty.call(PAISES, valor)
}

// Integrator ID de IA ERP en el Partners Program de Mercado Pago (Checkout Pro certificado).
export const INTEGRATOR_ID_IA_ERP = "dev_a09a21a5e94311f19b3aba9a69e9568a"
