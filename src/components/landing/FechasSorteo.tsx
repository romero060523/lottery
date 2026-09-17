import { useCountdown } from '../../hooks/useCountdown'
import { useMomentoAlcanzado } from '../../hooks/useMomentoAlcanzado'
import type { Sorteo } from '../../hooks/useSorteos'
import Reveal from './Reveal'

const formatoDia = new Intl.DateTimeFormat('es-CO', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Bogota',
})

const formatoHora = new Intl.DateTimeFormat('es-CO', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Bogota',
})

const dosDigitos = (n: number) => String(n).padStart(2, '0')

const etiqueta = 'text-[10px] leading-none font-semibold tracking-[.18em] text-parrafo uppercase'

type FechasSorteoProps = {
  sorteo: Sorteo
}

/**
 * Fecha del sorteo, cierre de ventas y cuenta regresiva. Cuenta hasta el cierre
 * de ventas y, cuando cierran, hasta el sorteo. Fechas en hora de Colombia.
 */
export default function FechasSorteo({ sorteo }: FechasSorteoProps) {
  const ventasCerradas = useMomentoAlcanzado(sorteo.fecha_fin_ventas)
  const hastaCierre = Boolean(sorteo.fecha_fin_ventas) && !ventasCerradas
  const objetivo = hastaCierre ? sorteo.fecha_fin_ventas : sorteo.fecha_sorteo
  const countdown = useCountdown(objetivo)

  const fechas = [
    { titulo: 'Sorteo', valor: sorteo.fecha_sorteo },
    { titulo: 'Cierre de ventas', valor: sorteo.fecha_fin_ventas },
  ].filter((f): f is { titulo: string; valor: string } => Boolean(f.valor))

  if (fechas.length === 0) return null

  const unidades = countdown
    ? [
        { valor: countdown.dias, nombre: 'Días' },
        { valor: countdown.horas, nombre: 'Horas' },
        { valor: countdown.minutos, nombre: 'Min' },
        { valor: countdown.segundos, nombre: 'Seg' },
      ]
    : []

  return (
    <Reveal
      variante="texto"
      desplazamiento={24}
      duracion={[0.8, 0.8]}
      retraso={0.08}
      className="w-full min-w-[min(100%,280px)] lg:w-auto"
    >
      <dl className="m-0 mb-[22px] flex flex-wrap gap-x-[clamp(24px,3vw,44px)] gap-y-4">
        {fechas.map(({ titulo, valor }) => (
          <div key={titulo}>
            <dt className={`mb-2 ${etiqueta}`}>{titulo}</dt>
            <dd className="m-0 text-[15px] leading-[1.35] font-semibold text-tinta first-letter:uppercase">
              <time dateTime={valor}>
                {formatoDia.format(new Date(valor))}
                <span className="block font-medium text-parrafo">{formatoHora.format(new Date(valor))}</span>
              </time>
            </dd>
          </div>
        ))}
      </dl>

      {countdown &&
        (countdown.terminado && !hastaCierre ? (
          <p className="m-0 font-display text-[clamp(26px,4vw,44px)] leading-none text-tinta uppercase">
            El sorteo ya se realizó
          </p>
        ) : (
          <>
            <div className={`mb-2.5 ${etiqueta} text-tinta`}>{hastaCierre ? 'Cierre de ventas en' : 'Sorteo en'}</div>
            <div
              role="timer"
              aria-live="off"
              aria-label={`${countdown.dias} días, ${countdown.horas} horas, ${countdown.minutos} minutos y ${countdown.segundos} segundos`}
              className="grid grid-cols-4 gap-2"
            >
              {unidades.map(({ valor, nombre }) => (
                <div
                  key={nombre}
                  aria-hidden="true"
                  className="flex min-w-0 flex-col items-center border border-tinta px-2 pt-3 pb-2.5 sm:min-w-[84px]"
                >
                  <span className="font-display text-[clamp(28px,4vw,48px)] leading-none text-tinta tabular-nums">
                    {dosDigitos(valor)}
                  </span>
                  <span className={`mt-2 ${etiqueta}`}>{nombre}</span>
                </div>
              ))}
            </div>
          </>
        ))}
    </Reveal>
  )
}
