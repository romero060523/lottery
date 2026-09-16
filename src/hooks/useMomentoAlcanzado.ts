import { useEffect, useState } from 'react'

// setTimeout admite hasta 2^31 - 1 ms (~24,8 días); más lejos, se reprograma.
const ESPERA_MAXIMA = 2 ** 31 - 1

/**
 * true desde que llega `fecha` (p. ej. apertura o cierre de ventas). Programa un
 * único timer hasta ese instante, sin re-renderizar cada segundo. null → false.
 */
export function useMomentoAlcanzado(fecha: string | null | undefined): boolean {
  const instante = fecha ? new Date(fecha).getTime() : null
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    if (instante === null || ahora >= instante) return

    // Si la fecha ya pasó (p. ej. llegó un sorteo actualizado), espera 0 ms.
    const espera = Math.min(Math.max(instante - Date.now(), 0), ESPERA_MAXIMA)
    const id = setTimeout(() => setAhora(Date.now()), espera)
    return () => clearTimeout(id)
  }, [instante, ahora])

  return instante !== null && ahora >= instante
}
