import { usePremios } from '../../hooks/usePremios'
import { useSorteoActual } from '../../hooks/useSorteos'
import PrizeCardMajor from './PrizeCardMajor'
import PrizeCardSecondary from './PrizeCardSecondary'
import Reveal from './Reveal'

/** 1 premio mayor + N secundarios, desde sorteo_premios. */
export default function PremiosSection() {
  const { data: sorteo, isError: errorSorteo } = useSorteoActual()
  const { data: premios, isError: errorPremios } = usePremios(sorteo?.id)

  const premioMayor = premios?.find((p) => p.tipo === 'mayor')
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
        Este line-up es para ti.
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
        <div className="flex flex-wrap items-start gap-[clamp(24px,4vw,56px)]">
          {premioMayor && <PrizeCardMajor premio={premioMayor} />}

          {secundarios.length > 0 && (
            <div className="flex min-w-[min(100%,260px)] flex-[1_1_300px] flex-col gap-[clamp(30px,5vh,62px)] pt-[clamp(0px,6vw,90px)]">
              {secundarios.map((premio, indice) => (
                <PrizeCardSecondary key={premio.id} premio={premio} indice={indice} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
