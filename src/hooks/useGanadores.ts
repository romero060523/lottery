import { useQuery } from '@tanstack/react-query'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type Ganador = Tables<'ganadores'>

/**
 * Hall of fame completo, de lo más reciente a lo más antiguo. La tabla es de
 * lectura pública (política `ganadores_select_publico`) y está vacía hasta que
 * se entregue la primera edición.
 */
export function useGanadores() {
  return useQuery({
    queryKey: ['ganadores'],
    queryFn: async (): Promise<Ganador[]> => {
      const { data, error } = await supabase
        .from('ganadores')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error
      return data
    },
  })
}
