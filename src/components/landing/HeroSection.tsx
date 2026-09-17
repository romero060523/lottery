import { useParallax } from '../../hooks/useParallax'
import { usePremios, type Premio } from '../../hooks/usePremios'
import { useSorteoActual, type Sorteo } from '../../hooks/useSorteos'
import { formatearCOP } from '../../utils/currency'
import Photo from './Photo'
import Reveal from './Reveal'

/** Badges, título, premio mayor y llamada a participar. */
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

      {/* Bajo md la foto del premio cae bajo el título y crece con el ancho (56vw):
          el margen crece con ella para que el botón no la tape.
          Desde md la foto va a la derecha y el botón sube junto al título. */}
      <div className="relative z-7 mt-[max(180px,calc(80vw-110px))] flex max-w-[560px] flex-col items-start md:mt-[clamp(36px,4vw,64px)]">
        <Reveal as="div" variante="texto" desplazamiento={24} duracion={[0.8, 0.8]} className="w-full sm:w-auto">
          <a
            href="#tickets"
            className="group flex w-full items-center justify-between gap-6 whitespace-nowrap sm:gap-10 rounded-full bg-tinta px-[clamp(32px,3.2vw,52px)] py-[clamp(24px,2.4vw,34px)] text-[clamp(15px,1.3vw,19px)] leading-none font-semibold tracking-[.14em] text-hueso uppercase hover:bg-morado hover:text-hueso sm:min-w-[440px]"
          >
            Participar ahora
            <span
              aria-hidden="true"
              className="inline-block text-[clamp(22px,2vw,30px)] transition-transform duration-300 group-hover:translate-x-[10px]"
            >
              →
            </span>
          </a>
        </Reveal>

        <div className="mt-[clamp(28px,3vw,40px)] w-full max-w-[430px]">
          {sorteo.descripcion && (
            <Reveal
              as="p"
              variante="texto"
              desplazamiento={24}
              duracion={[0.8, 0.8]}
              retraso={0.08}
              className="m-0 mb-[22px] text-[15px] leading-[1.55] text-pretty text-parrafo"
            >
              {sorteo.descripcion}
            </Reveal>
          )}
          <div className="h-px bg-tinta opacity-30" />
        </div>
      </div>
    </>
  )
}
