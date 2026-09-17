import { usePremios } from '../../hooks/usePremios'
import { useSorteoActual } from '../../hooks/useSorteos'
import PrizeCardSecondary from './PrizeCardSecondary'
import Reveal from './Reveal'

/** Premios secundarios en grilla, desde sorteo_premios. */
export default function PremiosSection() {
  const { data: sorteo, isError: errorSorteo } = useSorteoActual()
  const { data: premios, isError: errorPremios } = usePremios(sorteo?.id)

  const secundarios = premios?.filter((p) => p.tipo === 'secundario') ?? []

  return (
    <section
      id="premios"
      data-cursor-color="var(--color-coral)"
      className="relative border-t border-tinta/35 px-lateral py-seccion"
    >
      <div className="mb-[clamp(14px,2vh,26px)] flex items-start gap-[18px]">
        <span className="text-[11px] leading-none font-semibold tracking-[.2em] text-coral">01</span>
        <span className="mt-[5px] h-px flex-1 bg-tinta/30" />
      </div>

      <Reveal
        as="h2"
        variante="texto"
        desplazamiento={50}
        duracion={[0.9, 1]}
        className="m-0 max-w-[14ch] font-display text-[clamp(44px,11vw,166px)] leading-[.86] tracking-[-.02em] uppercase"
      >
        Este Sorteo es para ti.
      </Reveal>
      <Reveal
        as="p"
        variante="texto"
        desplazamiento={24}
        duracion={[0.8, 0.8]}
        retraso={0.1}
        className="mt-[26px] mb-[clamp(40px,7vh,84px)] max-w-[420px] text-[15px] leading-[1.55] text-parrafo"
      >
        Cada ticket participa por todos los premios de esta edición.
      </Reveal>

      {errorSorteo || errorPremios ? (
        <p className="text-[15px] leading-[1.55] text-parrafo">
          No pudimos cargar los premios. Intenta de nuevo en unos minutos.
        </p>
      ) : (
        secundarios.length > 0 && (
          <div className="grid grid-cols-[minmax(0,300px)] justify-center gap-x-[clamp(32px,6vw,96px)] gap-y-[clamp(96px,14vh,160px)] sm:grid-cols-[repeat(2,minmax(0,300px))] lg:grid-cols-[repeat(3,minmax(0,300px))]">
            {secundarios.map((premio, indice) => (
              <PrizeCardSecondary key={premio.id} premio={premio} indice={indice} />
            ))}
          </div>
        )
      )}
    </section>
  )
}
