// Datos de cada país de Mercado Pago soportado. El país sólo fija la moneda admitida y el sitio;
// los medios de pago los muestra Checkout Pro según la cuenta del vendedor.

export type Pais = "CL" | "BR" | "AR"

export type DatosPais = {
  site_id: "MLC" | "MLB" | "MLA"
  moneda: "clp" | "brl" | "ars"
}

export const PAISES: Record<Pais, DatosPais> = {
  CL: { site_id: "MLC", moneda: "clp" },
  BR: { site_id: "MLB", moneda: "brl" },
  AR: { site_id: "MLA", moneda: "ars" },
}

export function esPais(valor: string): valor is Pais {
  return valor === "CL" || valor === "BR" || valor === "AR"
}

// Integrator ID de IA ERP en el Partners Program de Mercado Pago (Checkout Pro certificado).
export const INTEGRATOR_ID_IA_ERP = "dev_a09a21a5e94311f19b3aba9a69e9568a"
