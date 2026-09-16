import { useParallax } from '../../hooks/useParallax'
import type { Premio } from '../../hooks/usePremios'
import { formatearCOP } from '../../utils/currency'
import Photo from './Photo'
import Reveal from './Reveal'

type PrizeCardMajorProps = {
  premio: Premio
}

/** Card grande del premio tipo 'mayor'. */
export default function PrizeCardMajor({ premio }: PrizeCardMajorProps) {
  const parallax = useParallax(-0.1)

  return (
    <article className="relative min-w-[min(100%,300px)] flex-[1_1_520px]">
      <div ref={parallax}>
        <Reveal
          variante="foto"
          rotacion={-3}
          duracion={[1, 1.1]}
          escalaAlHover
          className="relative flex aspect-[5/4] items-center justify-center border border-tinta bg-placeholder shadow-premio-mayor"
        >
          <Photo
            src={premio.imagen_url}
            alt={premio.nombre}
            placeholder={`Foto del premio · ${premio.nombre}`}
            className="text-[12px] leading-[1.3]"
          />
          {premio.badge_label && (
            <span className="absolute top-3.5 left-3.5 rounded-full bg-morado px-3.5 py-[7px] text-[10px] leading-none font-semibold tracking-[.16em] text-hueso uppercase">
              {premio.badge_label}
            </span>
          )}
        </Reveal>
      </div>

      <div className="mt-[22px] flex items-end justify-between gap-5">
        <div>
          <h3 className="m-0 font-display text-[clamp(34px,6vw,76px)] leading-[.9] tracking-[-.015em] uppercase">
            {premio.nombre}
          </h3>
          {premio.valor_referencial !== null && (
            <span className="mt-3 block text-[12px] leading-none font-semibold tracking-[.16em] text-morado uppercase">
              Valor referencial {formatearCOP(premio.valor_referencial)} COP
            </span>
          )}
        </div>
        {/* TODO: sin vista de detalle todavía; el prototipo tampoco le da acción */}
        <button
          type="button"
          aria-label={`Ver detalles de ${premio.nombre}`}
          className="group size-[62px] flex-none cursor-pointer rounded-full border border-tinta bg-hueso text-[20px] text-tinta hover:border-morado hover:bg-morado hover:text-hueso"
        >
          <span aria-hidden="true" className="inline-block transition-transform duration-300 group-hover:translate-x-[10px]">
            →
          </span>
        </button>
      </div>
    </article>
  )
}
