import { queryOptions, useQuery } from '@tanstack/react-query'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { useSorteoStore } from '../store/useSorteoStore'

export type Sorteo = Tables<'sorteos'>

const sorteosQuery = queryOptions({
  queryKey: ['sorteos'],
  // El retorno se anota a propósito: si el cliente perdiera el genérico
  // <Database>, esto falla en build en vez de degradar a `any` en silencio.
  queryFn: async (): Promise<Sorteo[]> => {
    const { data, error } = await supabase
      .from('sorteos')
      .select('*')
      .order('edicion_numero', { ascending: false })

    if (error) throw error
    return data
  },
})

/** Sorteos activos. RLS ya limita la lectura pública a `activo = true`. */
export function useSorteos() {
  return useQuery(sorteosQuery)
}

/**
 * El sorteo elegido en el store o, sin selección, la edición más reciente.
 * `null` si no hay ningún sorteo activo. Comparte caché con `useSorteos`.
 */
export function useSorteoActual() {
  const sorteoId = useSorteoStore((state) => state.sorteoId)

  return useQuery({
    ...sorteosQuery,
    select: (sorteos) => sorteos.find((s) => s.id === sorteoId) ?? sorteos[0] ?? null,
  })
}

/**
 * El sorteo de un id concreto (p. ej. `?sorteo=` en `/registro`) o, sin id, la
 * edición más reciente. `null` si ese id no está entre los sorteos activos: no
 * se cambia en silencio por otra edición, porque quien llega con un id vio el
 * precio y el cupo de esa. Comparte caché con `useSorteos`.
 */
export function useSorteoPorId(sorteoId: string | null | undefined) {
  return useQuery({
    ...sorteosQuery,
    select: (sorteos) => (sorteoId ? sorteos.find((s) => s.id === sorteoId) ?? null : sorteos[0] ?? null),
  })
}
