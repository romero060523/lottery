import { useParallax } from '../../hooks/useParallax'
import { usePremios, type Premio } from '../../hooks/usePremios'
import { useSorteoActual, type Sorteo } from '../../hooks/useSorteos'
import { formatearCOP } from '../../utils/currency'
import { formatearEntero } from '../../utils/number'
import FechasSorteo from './FechasSorteo'
import Photo from './Photo'
import Reveal from './Reveal'

/** Badges + countdown + contador de tickets registrados. */
export default function HeroSection() {
  const { data: sorteo, isPending, isError } = useSorteoActual()
  const { data: premios } = usePremios(sorteo?.id)

  let contenido = null
  if (isError) {
    contenido = <p className="text-[15px] leading-[1.55] text-parrafo">No pudimos cargar el sorteo. Intenta de nuevo en unos minutos.</p>
  } else if (!isPending && !sorteo) {
    contenido = <p className="text-[15px] leading-[1.55] text-parrafo">No hay sorteos activos en este momento.</p>
  } else if (sorteo) {
    contenido = <HeroContenido sorteo={sorteo} premioMayor={premios?.find((p) => p.tipo === 'mayor')} />
  }

  return (
    <section
      id="hero"
      data-cursor-color="var(--color-morado)"
      aria-busy={isPending}
      className="relative flex min-h-screen flex-col justify-center overflow-hidden px-lateral pt-[clamp(96px,14vh,160px)] pb-[clamp(48px,7vh,90px)]"
    >
      {contenido}
    </section>
  )
}

type HeroContenidoProps = {
  sorteo: Sorteo
  premioMayor: Premio | undefined
}

function HeroContenido({ sorteo, premioMayor }: HeroContenidoProps) {
  const parallaxFotoPrincipal = useParallax(-0.16)
  const parallaxFotoAmbiente = useParallax(-0.3)

  return (
    <>
      <div className="mb-[clamp(18px,3vh,34px)] flex flex-wrap gap-2">
        {sorteo.activo && (
          <Reveal
            as="span"
            variante="texto"
            desplazamiento={24}
            duracion={[0.7, 0.7]}
            className="inline-flex cursor-default items-center gap-[7px] rounded-full border border-tinta bg-amarillo px-[15px] py-2 text-[10px] leading-none font-semibold tracking-[.16em] text-tinta uppercase hover:bg-tinta hover:text-amarillo"
          >
            <span className="size-1.5 animate-pulso rounded-full bg-tinta motion-reduce:animate-none" />
            Sorteo activo
          </Reveal>
        )}
        <Reveal
          as="span"
          variante="texto"
          desplazamiento={24}
          duracion={[0.7, 0.7]}
          retraso={0.06}
          className="cursor-default rounded-full border border-tinta bg-azul px-[15px] py-2 text-[10px] leading-none font-semibold tracking-[.16em] text-hueso uppercase hover:bg-tinta"
        >
          Tickets a {formatearCOP(sorteo.precio_boleto)} COP
        </Reveal>
        <Reveal
          as="span"
          variante="texto"
          desplazamiento={24}
          duracion={[0.7, 0.7]}
          retraso={0.12}
          className="cursor-default rounded-full border border-tinta bg-morado px-[15px] py-2 text-[10px] leading-none font-semibold tracking-[.16em] text-hueso uppercase hover:bg-coral"
        >
          Edición limitada
        </Reveal>
      </div>

      <div className="relative">
        <h1 className="m-0 font-display text-[clamp(66px,17.5vw,268px)] leading-[.84] tracking-[-.025em] text-balance uppercase">
          <Reveal as="span" variante="texto" desplazamiento={60} duracion={[0.9, 1]} className="block text-tinta">
            Gana una
          </Reveal>
          <Reveal
            as="span"
            variante="texto"
            desplazamiento={60}
            duracion={[0.9, 1]}
            retraso={0.12}
            className="block text-morado"
          >
            {sorteo.nombre}
          </Reveal>
        </h1>

        {/* El premio mayor manda en el hero. Sube el tope de 380 a 460 px pero
            conserva el 34vw: así solo crece donde sobra ancho (desde ~1350 px) y
            el encuadre apretado del desktop angosto queda como estaba. Además
            entra en el viewport en vez de sangrar por la derecha, donde el
            overflow-hidden de la sección le cortaba la sombra, y lleva la sombra
            morada que el sistema de diseño reserva para el premio mayor
            (`--shadow-premio-mayor`, la misma de `PrizeCardMajor`). */}
        <div
          ref={parallaxFotoPrincipal}
          className="absolute top-[40%] right-[-2%] z-5 w-[56vw] will-change-transform md:top-[4%] md:right-[6%] md:w-[min(34vw,500px)]"
        >
          <Reveal
            variante="foto"
            rotacion={-7}
            duracion={[1, 1.2]}
            className="relative flex aspect-[4/5] items-end border border-tinta bg-placeholder p-3.5 shadow-foto md:shadow-premio-mayor"
          >
            <Photo
              src={premioMayor?.imagen_url ?? null}
              alt={premioMayor?.nombre ?? ''}
              placeholder="Foto del premio principal"
              prioritaria
              className="text-[11px] leading-[1.3]"
            />
            <span className="absolute top-3 left-3 rounded-full bg-coral px-3 py-1.5 text-[9px] leading-none font-semibold tracking-[.16em] text-hueso uppercase">
              Premio principal
            </span>
          </Reveal>
        </div>
      </div>

      <div className="relative z-7 mt-[clamp(180px,26vw,240px)] flex flex-wrap items-end justify-between gap-[clamp(22px,4vw,60px)]">
        <div className="max-w-[430px] min-w-[min(100%,280px)]">
          {sorteo.descripcion && (
            <Reveal
              as="p"
              variante="texto"
              desplazamiento={24}
              duracion={[0.8, 0.8]}
              className="m-0 mb-[22px] text-[15px] leading-[1.55] text-pretty text-parrafo"
            >
              {sorteo.descripcion}
            </Reveal>
          )}
          <div className="mb-[18px] h-px bg-tinta opacity-30" />
        </div>

        <FechasSorteo sorteo={sorteo} />

        <div className="flex min-w-[min(100%,280px)] flex-col gap-3.5">
          <a
            href="#tickets"
            className="group inline-flex items-center justify-between gap-6 rounded-full bg-tinta px-8 py-[22px] text-[13px] leading-none font-semibold tracking-[.14em] text-hueso uppercase hover:bg-morado hover:text-hueso"
          >
            Participar ahora
            <span aria-hidden="true" className="inline-block text-[17px] transition-transform duration-300 group-hover:translate-x-[10px]">
              →
            </span>
          </a>
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-[clamp(22px,3vw,34px)] leading-none text-morado">
              {formatearEntero(sorteo.tickets_vendidos)}
            </span>
            <span className="text-[10px] leading-none font-semibold tracking-[.18em] text-parrafo uppercase">
              / {formatearEntero(sorteo.tickets_totales)} tickets registrados
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
