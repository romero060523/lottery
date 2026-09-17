import { useParallax } from '../../hooks/useParallax'
import type { Premio } from '../../hooks/usePremios'
import { formatearCOP } from '../../utils/currency'
import Photo from './Photo'
import Reveal from './Reveal'

// Estilo de cada card de la grilla (rotación, parallax, fondo, sombra y badge).
// Todas comparten tamaño y proporción; si la edición tiene más de tres, el
// patrón se repite.
const VARIANTES = [
  {
    parallax: -0.2,
    rotacion: 6,
    marco: 'bg-placeholder-alt shadow-premio',
    badge: 'bg-coral text-hueso',
  },
  {
    parallax: -0.14,
    rotacion: -8,
    marco: 'bg-placeholder shadow-premio-azul',
    badge: 'bg-azul text-hueso',
  },
  {
    parallax: -0.24,
    rotacion: 5,
    marco: 'bg-placeholder-alt shadow-premio',
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
  // En la card completa, no solo en la foto: así la foto no tapa su título en la grilla.
  const parallax = useParallax<HTMLElement>(variante.parallax)

  return (
    <article ref={parallax} className="w-full">
      <Reveal
        variante="foto"
        rotacion={variante.rotacion}
        duracion={[1, 1.1]}
        escalaAlHover
        className={`relative flex aspect-[4/5] items-center justify-center border border-tinta ${variante.marco}`}
      >
        <Photo
          src={premio.imagen_url}
          alt={premio.nombre}
          placeholder="Foto del premio"
          className="text-[11px] leading-[1.3]"
        />
        {premio.badge_label && (
          <span
            className={`absolute top-2 left-2 rounded-full px-2 py-1 text-[9px] leading-none font-semibold tracking-[.16em] uppercase sm:top-3 sm:left-3 sm:px-3 sm:py-1.5 ${variante.badge}`}
          >
            {premio.badge_label}
          </span>
        )}
      </Reveal>

      <div className="mt-4 flex items-end justify-between gap-3.5 sm:mt-6">
        <div>
          <h3 className="m-0 font-display text-[clamp(20px,3.6vw,42px)] leading-[.92] uppercase">{premio.nombre}</h3>
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
          className="group hidden size-11 flex-none cursor-pointer rounded-full border border-tinta bg-transparent text-[13.333px] text-tinta hover:bg-tinta hover:text-hueso sm:inline-block"
        >
          <span aria-hidden="true" className="inline-block transition-transform duration-300 group-hover:translate-x-[10px]">
            →
          </span>
        </button>
      </div>
    </article>
  )
}
