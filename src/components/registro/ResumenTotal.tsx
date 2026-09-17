import type { MontoTotal } from '../../hooks/useMontoTotal'
import { formatearCOP } from '../../utils/currency'
import { formatearEntero } from '../../utils/number'

const plural = (n: number, singular: string, plural: string) => `${formatearEntero(n)} ${n === 1 ? singular : plural}`

type ResumenTotalProps = {
  precio: number
  cantidad: number
  cantidadValida: boolean
  /** Último total recibido; puede ser el de la cantidad anterior mientras llega el nuevo. */
  monto: MontoTotal | undefined
  /** El total de ESTA cantidad, ya confirmado por el servidor. */
  montoConfirmado: MontoTotal | null
  error: boolean
}

/** Detalle, total a pagar y cuántos tickets se reciben. */
export default function ResumenTotal({ precio, cantidad, cantidadValida, monto, montoConfirmado, error }: ResumenTotalProps) {
  function nota() {
    if (error) return 'No pudimos calcular el total. El monto definitivo lo calcula el servidor al reservar.'
    if (!cantidadValida) return 'Corrige la cantidad para ver el total.'
    if (montoConfirmado) {
      return montoConfirmado.tickets_gratis > 0
        ? `Recibirás ${plural(montoConfirmado.cantidad_total, 'ticket', 'tickets')}: ${formatearEntero(montoConfirmado.cantidad_comprada)} comprados + ${formatearEntero(montoConfirmado.tickets_gratis)} gratis.`
        : `Recibirás ${plural(montoConfirmado.cantidad_total, 'ticket', 'tickets')}.`
    }
    return 'El monto definitivo lo calcula el servidor con el precio de la edición.'
  }

  return (
    <div className="border border-tinta">
      <div className="flex items-baseline justify-between gap-3 px-[18px] py-3.5 text-[13px] leading-[1.4] text-parrafo">
        <span>
          {cantidadValida ? plural(cantidad, 'ticket', 'tickets') : '—'} × {formatearCOP(precio)}
        </span>
        <span className="font-semibold text-tinta">
          {cantidadValida && monto ? formatearCOP(monto.monto_total) : '—'}
        </span>
      </div>

      <div
        aria-live="polite"
        className={`flex flex-wrap items-baseline justify-between gap-2 bg-tinta px-[18px] py-4 transition-opacity duration-200 ease-[ease] ${montoConfirmado ? '' : 'opacity-60'}`}
      >
        <span className="text-[10px] leading-none font-semibold tracking-[.2em] text-hueso/70 uppercase">Total a pagar</span>
        <span className="font-display text-[clamp(32px,7vw,48px)] leading-none tracking-[-.01em] text-amarillo">
          {/* Con una cantidad inválida no se muestra "$0": se lee como un precio
              real en vez de como un campo por corregir. */}
          {cantidadValida && monto ? `${formatearCOP(monto.monto_total)} COP` : '—'}
        </span>
      </div>

      <p className="m-0 border-t border-tinta/25 px-[18px] py-3 text-[12px] leading-[1.5] text-parrafo">{nota()}</p>
    </div>
  )
}
