import type { Sorteo } from '../hooks/useSorteos'

// Espejo de public.calcular_tickets_gratis y de las condiciones de comprar_tickets
// (sección 2 de docs/arquitectura.md). Solo acota el selector: los montos y los
// gratis que se muestran salen de calcular_monto_total, y el servidor vuelve a
// validar todo al comprar.
const ENTERO_MAXIMO = 2147483647

/** Cupo que consume una compra: comprados más gratis (4 comprados = 1 gratis). */
export function cupoDeCompra(cantidad: number): number {
  return cantidad + Math.floor(cantidad / 4)
}

export function ticketsRestantes(sorteo: Pick<Sorteo, 'tickets_totales' | 'tickets_vendidos'>): number {
  return Math.max(0, sorteo.tickets_totales - sorteo.tickets_vendidos)
}

/**
 * Mayor cantidad que comprar_tickets aceptaría hoy: tope por compra, cupo
 * restante contando los gratis y monto dentro de integer. 0 si no cabe ninguna.
 */
export function maximoComprable(
  sorteo: Pick<Sorteo, 'tickets_totales' | 'tickets_vendidos' | 'max_tickets_por_compra' | 'precio_boleto'>,
): number {
  const restantes = ticketsRestantes(sorteo)
  let maximo = Math.min(sorteo.max_tickets_por_compra, Math.floor(ENTERO_MAXIMO / sorteo.precio_boleto))
  while (maximo > 0 && cupoDeCompra(maximo) > restantes) maximo--
  return maximo
}

export type EstadoVenta = 'disponible' | 'agotada' | 'no_iniciada' | 'cerrada'

/** Qué puede hacer el comprador ahora. Cerrar la venta gana sobre agotar el cupo. */
export function estadoVenta({
  activo,
  iniciada,
  finalizada,
  maximo,
}: {
  activo: boolean
  iniciada: boolean
  finalizada: boolean
  maximo: number
}): EstadoVenta {
  if (!activo || finalizada) return 'cerrada'
  if (!iniciada) return 'no_iniciada'
  if (maximo < 1) return 'agotada'
  return 'disponible'
}
