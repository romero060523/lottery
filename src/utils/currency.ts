// Sección 4 de docs/arquitectura.md — COP se muestra sin decimales.
const formatoCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
})

/** formatearCOP(5000) → "$ 5.000" */
export function formatearCOP(monto: number): string {
  return formatoCOP.format(monto)
}
