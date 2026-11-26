// Montos: Medusa trabaja en la unidad mayor de la moneda (49.99 = 49,99). Mercado Pago también, pero
// exige respetar los decimales de cada moneda (CLP sin decimales). Se redondea en notación decimal para
// evitar errores de coma flotante (1.005 con 2 decimales → 1.01).

export function redondear(monto: number, decimales: number): number {
  if (!Number.isFinite(monto)) throw new Error(`monto inválido: ${monto}`)
  const r = Number(`${Math.round(Number(`${monto}e${decimales}`))}e-${decimales}`)
  if (Number.isFinite(r)) return r
  // Montos que JavaScript escribe en notación exponencial (1e-7, 1.5e21).
  const f = 10 ** decimales
  return Math.round(monto * f) / f
}

// ¿Lo pagado es lo esperado? Compara ya redondeado a los decimales de la moneda.
export function iguales(pagado: number, esperado: number, decimales: number): boolean {
  return redondear(pagado, decimales) === redondear(esperado, decimales)
}
