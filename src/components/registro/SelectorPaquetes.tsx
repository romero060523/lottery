import { useMontosTotales } from '../../hooks/useMontoTotal'
import { formatearCOP } from '../../utils/currency'
import { formatearEntero } from '../../utils/number'

/** Atajos del selector; cualquier otra cantidad se escribe en el stepper. */
const PAQUETES = [1, 3, 5, 10] as const

type SelectorPaquetesProps = {
  precio: number
  /** Mayor cantidad que `comprar_tickets` aceptaría ahora (`maximoComprable`). */
  maximo: number
  cantidad: number
  onElegir: (cantidad: number) => void
}

/** Tarjetas de 1, 3, 5 y 10 tickets con su total y sus gratis. */
export default function SelectorPaquetes({ precio, maximo, cantidad, onElegir }: SelectorPaquetesProps) {
  const montos = useMontosTotales(PAQUETES, precio)

  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-3 block p-0 text-[10px] leading-none font-semibold tracking-[.2em] text-parrafo uppercase">
        Elige tu paquete de tickets
      </legend>

      <div className="grid grid-cols-2 gap-3">
        {PAQUETES.map((paquete, i) => {
          const monto = montos[i].data
          const elegido = cantidad === paquete
          const gratis = monto?.tickets_gratis ?? 0

          return (
            <button
              key={paquete}
              type="button"
              aria-pressed={elegido}
              disabled={paquete > maximo}
              onClick={() => onElegir(paquete)}
              className={`flex flex-col items-start border p-4 text-left transition-[translate,box-shadow] duration-300 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
                elegido
                  ? 'border-tinta bg-morado text-hueso shadow-pase'
                  : 'border-tinta bg-hueso text-tinta enabled:hover:-translate-y-1 enabled:hover:shadow-foto-sm'
              }`}
            >
              <span className={`text-[9px] leading-none font-semibold tracking-[.18em] uppercase ${elegido ? 'text-hueso/75' : 'text-parrafo'}`}>
                {paquete === 1 ? 'Individual' : 'Paquete'}
              </span>

              <span className="mt-3 flex items-baseline gap-1.5">
                <span className="font-display text-[clamp(34px,9vw,44px)] leading-none">{formatearEntero(paquete)}</span>
                <span className="text-[11px] leading-none font-semibold tracking-[.14em] uppercase">
                  {paquete === 1 ? 'ticket' : 'tickets'}
                </span>
              </span>

              <span
                className={`mt-3 inline-block rounded-full px-2.5 py-1.5 text-[9px] leading-none font-semibold tracking-[.12em] uppercase ${
                  gratis > 0 ? 'bg-amarillo text-tinta' : elegido ? 'border border-hueso/45 text-hueso/80' : 'border border-tinta/45 text-parrafo'
                }`}
              >
                {gratis > 0 ? `+ ${formatearEntero(gratis)} gratis` : 'Precio regular'}
              </span>

              <span className="mt-3.5 font-display text-[22px] leading-none">
                {monto ? formatearCOP(monto.monto_total) : '—'}
              </span>

              <span className={`mt-3.5 w-full border-t pt-2.5 text-[9px] leading-none font-semibold tracking-[.14em] uppercase ${elegido ? 'border-hueso/35 text-hueso' : 'border-tinta/25 text-parrafo'}`}>
                {elegido ? 'Seleccionado ✓' : 'Elegir paquete ↗'}
              </span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
