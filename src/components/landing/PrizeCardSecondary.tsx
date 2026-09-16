import { useParallax } from '../../hooks/useParallax'
import type { Premio } from '../../hooks/usePremios'
import { formatearCOP } from '../../utils/currency'
import Photo from './Photo'
import Reveal from './Reveal'

// Composición de la columna de secundarios del prototipo, card por card. Si la
// edición tiene más de tres, el patrón se repite.
const VARIANTES = [
  {
    columna: 'self-start w-[min(100%,290px)]',
    parallax: -0.2,
    rotacion: 6,
    marco: 'aspect-[4/5] bg-placeholder-alt shadow-premio',
    badge: 'bg-coral text-hueso',
  },
  {
    columna: 'self-end w-[min(100%,250px)]',
    parallax: -0.14,
    rotacion: -8,
    marco: 'aspect-square bg-placeholder shadow-premio-azul',
    badge: 'bg-azul text-hueso',
  },
  {
    columna: 'self-start w-[min(100%,270px)]',
    parallax: -0.24,
    rotacion: 5,
    marco: 'aspect-[4/3] bg-placeholder-alt shadow-premio',
    badge: 'bg-amarillo text-tinta',
  },
] as const

type PrizeCardSecondaryProps = {
  premio: Premio
  /** Posición entre los secundarios; elige la variante visual. */
  indice: number
}

/** Card de premio 'secundario' (top pick / bonus), se repite. */
export default function PrizeCardSecondary({ premio, indice }: PrizeCardSecondaryProps) {
  const variante = VARIANTES[indice % VARIANTES.length]
  const parallax = useParallax(variante.parallax)

  return (
    <article className={variante.columna}>
      <div ref={parallax}>
        <Reveal
          variante="foto"
          rotacion={variante.rotacion}
          duracion={[1, 1.1]}
          escalaAlHover
          className={`relative flex items-center justify-center border border-tinta ${variante.marco}`}
        >
          <Photo
            src={premio.imagen_url}
            alt={premio.nombre}
            placeholder="Foto del premio"
            className="text-[11px] leading-[1.3]"
          />
          {premio.badge_label && (
            <span
              className={`absolute top-3 left-3 rounded-full px-3 py-1.5 text-[9px] leading-none font-semibold tracking-[.16em] uppercase ${variante.badge}`}
            >
              {premio.badge_label}
            </span>
          )}
        </Reveal>
      </div>

      <div className="mt-4 flex items-end justify-between gap-3.5">
        <div>
          <h3 className="m-0 font-display text-[clamp(26px,3.6vw,42px)] leading-[.92] uppercase">{premio.nombre}</h3>
          {premio.valor_referencial !== null && (
            <span className="mt-[7px] block text-[11px] leading-none font-medium tracking-[.14em] text-parrafo uppercase">
              {formatearCOP(premio.valor_referencial)} COP
            </span>
          )}
        </div>
        {/* TODO: sin vista de detalle todavía; el prototipo tampoco le da acción.
            13.333px es el tamaño por defecto de <button>, que el prototipo no sobrescribe. */}
        <button
          type="button"
          aria-label={`Ver detalles de ${premio.nombre}`}
          className="group size-11 flex-none cursor-pointer rounded-full border border-tinta bg-transparent text-[13.333px] text-tinta hover:bg-tinta hover:text-hueso"
        >
          <span aria-hidden="true" className="inline-block transition-transform duration-300 group-hover:translate-x-[10px]">
            →
          </span>
        </button>
      </div>
    </article>
  )
}
