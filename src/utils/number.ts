// Mismo locale que utils/currency.ts: miles con punto.
const formatoEntero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/** formatearEntero(3842) → "3.842" */
export function formatearEntero(numero: number): string {
  return formatoEntero.format(numero)
}
