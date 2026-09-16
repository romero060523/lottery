import { skipToken, useQuery } from '@tanstack/react-query'
import type { Tables } from '../lib/database.types'
import { supabase } from '../lib/supabase'

// Solo lo que muestra la landing: la auditoría (creado_por/actualizado_por) no
// tiene por qué viajar al navegador público.
export type Premio = Pick<
  Tables<'sorteo_premios'>,
  'id' | 'nombre' | 'tipo' | 'badge_label' | 'valor_referencial' | 'imagen_url' | 'orden'
>

/** Premios de un sorteo en el orden que define el admin. RLS los limita a sorteos activos. */
export function usePremios(sorteoId: string | undefined) {
  return useQuery({
    queryKey: ['sorteo_premios', sorteoId],
    queryFn: sorteoId
      ? async (): Promise<Premio[]> => {
          const { data, error } = await supabase
            .from('sorteo_premios')
            .select('id, nombre, tipo, badge_label, valor_referencial, imagen_url, orden')
            .eq('sorteo_id', sorteoId)
            .order('orden')

          if (error) throw error
          return data
        }
      : skipToken,
  })
}
