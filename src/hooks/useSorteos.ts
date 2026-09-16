import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/** Sorteos activos. RLS ya limita la lectura pública a `activo = true`. */
export function useSorteos() {
  return useQuery({
    queryKey: ['sorteos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sorteos')
        .select('*')
        .order('edicion_numero', { ascending: false })

      if (error) throw error
      return data
    },
  })
}
