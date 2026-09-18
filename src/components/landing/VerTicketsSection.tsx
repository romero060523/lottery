import { useCirculoScroll } from '../../hooks/useCirculoScroll'
import { useSorteoActual } from '../../hooks/useSorteos'
import { TIPOS_DOCUMENTO } from '../../utils/registro'
import DigitalPassPreview from './DigitalPassPreview'
import Reveal from './Reveal'

const CAMPO =
  'w-full rounded-[6px] border border-tinta bg-hueso px-4 py-3.5 text-[15px] leading-[1.4] text-tinta outline-none focus-visible:border-morado focus-visible:ring-1 focus-visible:ring-morado'

const ETIQUETA = 'mb-2.5 block text-[10px] leading-none font-semibold tracking-[.2em] text-parrafo uppercase'

/**
 * «Ver tickets»: por ahora solo la vista. El buscador por documento vive en
 * `/consulta` (TicketLookupPage) y todavía no existe, así que el formulario no
 * envía nada y las tarjetas son ejemplos.
 *
 * El círculo que crece con el scroll es el efecto que docs/design-system.md
 * describe para la sección de transparencia; se usa aquí por decisión de diseño,
 * en amarillo y sin la inversión de color del prototipo: sobre amarillo el texto
 * se lee mejor en tinta.
 */
export default function VerTicketsSection() {
  const { data: sorteo } = useSorteoActual()
  const { refSeccion, refCirculo } = useCirculoScroll()

  return (
    <section
      ref={refSeccion}
      id="mis-tickets"
      data-cursor-color="var(--color-amarillo)"
      className="relative overflow-hidden border-t border-tinta/35 px-lateral py-seccion"
    >
      {/* Tamaño, anclaje, centrado y escala los escribe el hook desde la caja de
          la sección; estas medidas en vw son el respaldo del primer frame. El
          centrado va por margen negativo, no con -translate-x-1/2: el hook usa el
          transform del elemento y una utilidad de translate se lo pisaría. */}
      <div
        ref={refCirculo}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-60vw] left-1/2 ml-[-60vw] size-[120vw] rounded-full bg-amarillo will-change-transform"
      />

      <div className="relative z-2">
        <div className="mb-[clamp(14px,2vh,26px)] flex items-start gap-[18px]">
          <span className="text-[11px] leading-none font-semibold tracking-[.2em] text-tinta">02</span>
          <span className="mt-[5px] h-px flex-1 bg-tinta/30" />
        </div>

        <Reveal
          as="h2"
          variante="texto"
          desplazamiento={50}
          duracion={[0.9, 1]}
          className="m-0 max-w-[14ch] font-display text-[clamp(44px,11vw,166px)] leading-[.86] tracking-[-.02em] uppercase"
        >
          Mira tus tickets.
        </Reveal>
        <Reveal
          as="p"
          variante="texto"
          desplazamiento={24}
          duracion={[0.8, 0.8]}
          retraso={0.1}
          className="mt-[26px] mb-0 max-w-[420px] text-[15px] leading-[1.55] text-parrafo"
        >
          Con el documento que usaste al comprar vas a ver todos tus pases y en qué estado está cada uno.
        </Reveal>

        {/* Sin react-hook-form ni zod: no hay envío que validar todavía. */}
        <form noValidate onSubmit={(evento) => evento.preventDefault()} className="mt-[clamp(34px,5vh,56px)] max-w-[620px]">
          <div className="grid gap-[18px] sm:grid-cols-[minmax(0,220px)_1fr]">
            <div>
              <label htmlFor="consulta-tipo-documento" className={ETIQUETA}>
                Tipo de documento
              </label>
              <select id="consulta-tipo-documento" defaultValue="cedula" className={CAMPO}>
                {TIPOS_DOCUMENTO.map((tipo) => (
                  <option key={tipo.valor} value={tipo.valor}>
                    {tipo.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="consulta-numero-documento" className={ETIQUETA}>
                Número de documento
              </label>
              <input
                id="consulta-numero-documento"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={32}
                placeholder="Sin puntos ni espacios"
                className={CAMPO}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled
            className="mt-[22px] flex w-full items-center justify-between gap-5 rounded-full border border-tinta bg-transparent px-8 py-6 text-[13px] leading-none font-semibold tracking-[.14em] text-tinta uppercase disabled:cursor-not-allowed sm:w-auto sm:min-w-[360px]"
          >
            Buscar mis tickets
            <span aria-hidden="true" className="inline-block text-[17px]">
              →
            </span>
          </button>

          <p className="mt-3.5 mb-0 text-[11px] leading-[1.6] text-parrafo">
            El buscador todavía no está disponible: esta vista es una muestra de cómo verás tus pases cuando lo abramos.
          </p>
        </form>

        {sorteo && (
          <div className="mt-[clamp(44px,7vh,88px)]">
            <span className="mb-[clamp(20px,3vh,32px)] block text-[10px] leading-none font-semibold tracking-[.2em] text-parrafo uppercase">
              Así se verán tus tickets · ejemplo
            </span>
            <div className="flex flex-wrap gap-[clamp(28px,4vw,64px)]">
              <DigitalPassPreview sorteo={sorteo} sufijo="00000" estado="confirmado" tickets={3} rotacion={-6} />
              <DigitalPassPreview sorteo={sorteo} sufijo="00001" estado="pendiente" tickets={1} rotacion={4} retraso={0.1} />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
