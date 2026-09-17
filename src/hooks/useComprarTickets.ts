import type { PostgrestError } from '@supabase/supabase-js'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

export type ArgsCompra = Database['public']['Functions']['comprar_tickets']['Args']
export type BoletoEmitido = Database['public']['Functions']['comprar_tickets']['Returns']

/**
 * Reserva cupo y crea el boleto en `pendiente` (sección 3 de
 * docs/arquitectura.md). A diferencia de `calcular_monto_total`, esta llamada
 * escribe, así que **nunca se reintenta**: mientras no exista la
 * `idempotency_key` del servidor (pendiente #3), un segundo intento del mismo
 * envío reserva un segundo boleto. `retry: 0` es el valor por omisión de las
 * mutaciones; se declara para que un cambio en los defaults del QueryClient no
 * lo active.
 *
 * Se expone `reservar` en vez de `mutate` porque `isPending` solo llega a la UI
 * en el render siguiente: dos envíos disparados antes de ese render verían
 * `isPending === false` y llamarían dos veces a la RPC. El pestillo se cierra en
 * el mismo turno del primer envío y se abre al terminar la llamada, así que un
 * rechazo se puede reintentar.
 */
export function useComprarTickets() {
  const queryClient = useQueryClient()

  const mutacion = useMutation<BoletoEmitido, PostgrestError, ArgsCompra>({
    retry: 0,
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('comprar_tickets', args)
      if (error) throw error
      return data
    },
    // Haya vendido o no, `tickets_vendidos` pudo cambiar: quien lea el sorteo
    // (esta página y la landing) necesita el cupo de ahora, no el de antes.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sorteos'] }),
  })

  const pestillo = useRef(false)
  const { mutate } = mutacion

  const reservar = useCallback(
    (args: ArgsCompra) => {
      if (pestillo.current) return
      pestillo.current = true
      mutate(args, {
        onSettled: () => {
          pestillo.current = false
        },
      })
    },
    [mutate],
  )

  return { ...mutacion, reservar }
}
