import { useEffect, useState } from 'react'

export type Countdown = {
  dias: number
  horas: number
  minutos: number
  segundos: number
  terminado: boolean
}

function restante(hasta: number): Countdown {
  const ms = Math.max(0, hasta - Date.now())
  const total = Math.floor(ms / 1000)

  return {
    dias: Math.floor(total / 86400),
    horas: Math.floor(total / 3600) % 24,
    minutos: Math.floor(total / 60) % 60,
    segundos: total % 60,
    terminado: ms === 0,
  }
}

/** Cuenta regresiva hasta `sorteos.fecha_fin_ventas`. */
export function useCountdown(fechaFin: Date | string | null | undefined): Countdown | null {
  const timestamp = fechaFin ? new Date(fechaFin).getTime() : null

  // El valor se deriva en cada render; el intervalo solo fuerza el re-render.
  const [, refrescar] = useState(0)

  useEffect(() => {
    if (timestamp === null) return

    const id = setInterval(() => {
      refrescar((n) => n + 1)
      if (Date.now() >= timestamp) clearInterval(id)
    }, 1000)
    return () => clearInterval(id)
  }, [timestamp])

  return timestamp === null ? null : restante(timestamp)
}
