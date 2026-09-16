import { keepPreviousData, queryOptions, useQueries, useQuery } from '@tanstack/react-query'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type MontoTotal = Database['public']['Functions']['calcular_monto_total']['Returns'][number]

// Solo previsualización: calcular_monto_total no reserva cupo. comprar_tickets,
// que sí reserva, queda para el flujo de RegisterFormPage.
function montoTotalQuery(cantidad: number, precioBoleto: number) {
  return queryOptions({
    queryKey: ['calcular_monto_total', cantidad, precioBoleto],
    queryFn: async (): Promise<MontoTotal> => {
      const { data, error } = await supabase.rpc('calcular_monto_total', {
        p_cantidad: cantidad,
        p_precio_boleto: precioBoleto,
      })

      if (error) throw error
      const [fila] = data
      if (!fila) throw new Error('calcular_monto_total no devolvió resultado')
      return fila
    },
    // La función es inmutable: mismos argumentos, mismo resultado.
    staleTime: Infinity,
  })
}

/** Total de la cantidad elegida. Mientras llega uno nuevo conserva el anterior (isPlaceholderData). */
export function useMontoTotal(cantidad: number, precioBoleto: number) {
  return useQuery({ ...montoTotalQuery(cantidad, precioBoleto), placeholderData: keepPreviousData })
}

/** Totales de varias cantidades fijas (quick-picks); comparten caché con useMontoTotal. */
export function useMontosTotales(cantidades: readonly number[], precioBoleto: number) {
  return useQueries({ queries: cantidades.map((cantidad) => montoTotalQuery(cantidad, precioBoleto)) })
}
