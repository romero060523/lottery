import { useQuery } from '@tanstack/react-query'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type Sorteo = Tables<'sorteos'>

/** Sorteos activos. RLS ya limita la lectura pública a `activo = true`. */
export function useSorteos() {
  return useQuery({
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
}
