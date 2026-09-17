import type { ReactNode } from 'react'
import { useCountdown } from '../../hooks/useCountdown'
import { useMomentoAlcanzado } from '../../hooks/useMomentoAlcanzado'
import { useParallax } from '../../hooks/useParallax'
import { useSorteoActual, type Sorteo } from '../../hooks/useSorteos'
import Reveal from './Reveal'

const ZONA = 'America/Bogota'

const formatoFecha = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: ZONA,
})

const formatoHora = new Intl.DateTimeFormat('es-CO', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: ZONA,
})

const dosDigitos = (n: number) => String(n).padStart(2, '0')

const badge =
  'inline-block rounded-full px-2.5 py-1.5 text-[9px] leading-none font-semibold tracking-[.1em] whitespace-nowrap uppercase sm:px-3 sm:text-[10px] sm:tracking-[.16em]'

/** Fecha del sorteo, cierre de ventas y cuenta regresiva, entre el Hero y los premios. */
export default function FechasSorteoSection() {
  const { data: sorteo } = useSorteoActual()

  if (!sorteo || (!sorteo.fecha_sorteo && !sorteo.fecha_fin_ventas)) return null

  return <FechasSorteo sorteo={sorteo} />
}

function FechasSorteo({ sorteo }: { sorteo: Sorteo }) {
  const ventasCerradas = useMomentoAlcanzado(sorteo.fecha_fin_ventas)
  const hastaCierre = Boolean(sorteo.fecha_fin_ventas) && !ventasCerradas
  const countdown = useCountdown(hastaCierre ? sorteo.fecha_fin_ventas : sorteo.fecha_sorteo)

  return (
    <section
      id="fechas"
      aria-label="Fechas del sorteo"
      data-cursor-color="var(--color-morado)"
      className="relative border-t border-tinta/35 px-lateral py-[clamp(56px,9vh,110px)]"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-12 lg:grid-cols-[.8fr_1.8fr_.8fr] lg:items-center lg:gap-[clamp(28px,3vw,56px)]">
        {sorteo.fecha_sorteo && (
          <Cuadro parallax={-0.12} rotacion={-5} retrasoBalanceo={0} className="bg-morado text-center text-hueso shadow-foto">
            <span className={`${badge} bg-amarillo text-tinta`}>Sorteo</span>
            <Fecha valor={sorteo.fecha_sorteo} />
          </Cuadro>
        )}

        {countdown && (
          <Cuadro
            parallax={-0.06}
            rotacion={-2}
            retrasoBalanceo={-2}
            envoltura="col-span-2 order-last lg:col-span-1 lg:order-none"
            className="bg-tinta text-hueso shadow-pase"
          >
            {countdown.terminado && !hastaCierre ? (
              <>
                <span className={`${badge} bg-coral text-hueso`}>Sorteo</span>
                <p className="m-0 mt-5 font-display text-[clamp(34px,5vw,72px)] leading-[.9] text-amarillo uppercase">
                  El sorteo ya se realizó
                </p>
              </>
            ) : (
              <>
                <span className={`${badge} bg-coral text-hueso`}>
                  {hastaCierre ? 'Faltan para el cierre' : 'Faltan para el sorteo'}
                </span>
                <div
                  role="timer"
                  aria-live="off"
                  aria-label={`${countdown.dias} días, ${countdown.horas} horas, ${countdown.minutos} minutos y ${countdown.segundos} segundos`}
                  className="mt-5 flex items-start justify-between gap-1"
                >
                  <Unidad valor={countdown.dias} nombre="Días" />
                  <Separador />
                  <Unidad valor={countdown.horas} nombre="Horas" />
                  <Separador />
                  <Unidad valor={countdown.minutos} nombre="Min" />
                  <Separador />
                  <Unidad valor={countdown.segundos} nombre="Seg" latido />
                </div>
              </>
            )}
          </Cuadro>
        )}

        {sorteo.fecha_fin_ventas && (
          <Cuadro parallax={-0.18} rotacion={5} retrasoBalanceo={-4} className="bg-coral text-center text-hueso shadow-foto">
            <span className={`${badge} bg-tinta text-hueso`}>{ventasCerradas ? 'Ventas cerradas' : 'Cierre de ventas'}</span>
            <Fecha valor={sorteo.fecha_fin_ventas} />
          </Cuadro>
        )}
      </div>
    </section>
  )
}

type CuadroProps = {
  parallax: number
  rotacion: number
  /** Segundos (negativo = arranca a mitad de ciclo), para que no floten sincronizados. */
  retrasoBalanceo: number
  /** Clases de la celda de la grilla. */
  envoltura?: string
  className: string
  children: ReactNode
}

/**
 * Parallax, balanceo y Reveal van en capas separadas: cada una escribe su propio
 * `transform` y en el mismo elemento se pisarían.
 */
function Cuadro({ parallax, rotacion, retrasoBalanceo, envoltura = '', className, children }: CuadroProps) {
  const ref = useParallax(parallax)

  return (
    <div ref={ref} className={envoltura}>
      <div
        className="animate-balanceo motion-reduce:animate-none"
        style={{ animationDelay: `${retrasoBalanceo}s` }}
      >
        <Reveal
          variante="foto"
          rotacion={rotacion}
          duracion={[1, 1.1]}
          escalaAlHover
          className={`relative border border-tinta p-[clamp(16px,2.2vw,28px)] ${className}`}
        >
          {children}
        </Reveal>
      </div>
    </div>
  )
}

function Fecha({ valor }: { valor: string }) {
  const fecha = new Date(valor)
  const partes = Object.fromEntries(formatoFecha.formatToParts(fecha).map((p) => [p.type, p.value]))
  const mes = partes.month?.replace('.', '')

  return (
    <time dateTime={valor} className="mt-4 block">
      <span className="block font-display text-[clamp(64px,9vw,136px)] leading-[.85]">{partes.day}</span>
      <span className="mt-1 block font-display text-[clamp(22px,2.8vw,38px)] leading-none uppercase">
        {mes} {partes.year}
      </span>
      <span className="mt-3 block text-[11px] leading-[1.4] font-semibold tracking-[.14em] text-hueso/85 uppercase sm:text-[13px]">
        {partes.weekday}
        <span className="block sm:inline">
          <span className="hidden sm:inline"> · </span>
          {formatoHora.format(fecha)}
        </span>
      </span>
    </time>
  )
}

function Unidad({ valor, nombre, latido = false }: { valor: number; nombre: string; latido?: boolean }) {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col items-center">
      <span className="font-display text-[clamp(44px,7vw,112px)] leading-none text-amarillo tabular-nums">
        <span key={latido ? valor : undefined} className={`inline-block ${latido ? 'animate-latido motion-reduce:animate-none' : ''}`}>
          {dosDigitos(valor)}
        </span>
      </span>
      <span className="mt-2 text-[10px] leading-none font-semibold tracking-[.18em] text-hueso/70 uppercase">{nombre}</span>
    </div>
  )
}

function Separador() {
  return (
    <span aria-hidden="true" className="font-display text-[clamp(36px,5.5vw,88px)] leading-none text-hueso/40">
      :
    </span>
  )
}
