import { useParallax } from '../../hooks/useParallax'
import { useSorteoActual, type Sorteo } from '../../hooks/useSorteos'
import { formatearCOP } from '../../utils/currency'
import DigitalPassPreview from './DigitalPassPreview'
import Reveal from './Reveal'

type Paso = {
  titulo: string
  texto: string
  color: string
  icono: string
  alineacion: string
}

// Composición del prototipo. Los textos de los pasos 2 y 3 se ajustan al flujo
// real (sección 3 de docs/arquitectura.md): la revisión del pago es manual y no
// se guarda correo, así que no se promete confirmación inmediata ni envío por email.
function pasos(sorteo: Sorteo | null | undefined): Paso[] {
  const horas = sorteo?.ttl_pendientes_horas
  return [
    {
      titulo: '01 · Elige tus tickets',
      texto: sorteo
        ? `Suma participaciones desde ${formatearCOP(sorteo.precio_boleto)} COP cada una.`
        : 'Suma las participaciones que quieras.',
      color: 'text-azul',
      icono: 'rotate-[-6deg] bg-placeholder',
      alineacion: 'self-start',
    },
    {
      titulo: '02 · Paga de forma segura',
      texto: horas
        ? `Tu reserva se guarda ${horas} ${horas === 1 ? 'hora' : 'horas'} mientras validamos tu pago.`
        : 'Tu reserva se guarda mientras validamos tu pago.',
      color: 'text-coral',
      icono: 'rotate-[7deg] bg-placeholder-alt',
      alineacion: 'self-end flex-row-reverse text-right',
    },
    {
      titulo: '03 · Recibe tu pase digital',
      texto: 'Con el pago validado, tu código único queda confirmado.',
      color: 'text-morado',
      icono: 'rotate-[-4deg] bg-placeholder',
      alineacion: 'self-start',
    },
  ]
}

/** 3 pasos + preview del pase digital. */
export default function MecanicaSection() {
  const { data: sorteo } = useSorteoActual()
  const parallax = useParallax(-0.12)

  return (
    <section
      id="mecanica"
      data-cursor-color="var(--color-azul)"
      className="relative overflow-hidden border-t border-tinta/35 px-lateral py-seccion"
    >
      <div className="mb-[clamp(14px,2vh,26px)] flex items-start gap-[18px]">
        <span className="text-[11px] leading-none font-semibold tracking-[.2em] text-azul">02</span>
        <span className="mt-[5px] h-px flex-1 bg-tinta/30" />
      </div>

      <h2 className="m-0 mb-[clamp(44px,7vh,90px)] max-w-[15ch] font-display text-[clamp(44px,11vw,166px)] leading-[.86] tracking-[-.02em] uppercase">
        <Reveal as="span" variante="texto" desplazamiento={50} duracion={[0.9, 1]} className="block text-coral">
          Un ticket
        </Reveal>
        <Reveal
          as="span"
          variante="texto"
          desplazamiento={50}
          duracion={[0.9, 1]}
          retraso={0.1}
          className="block text-tinta"
        >
          Una posibilidad real.
        </Reveal>
      </h2>

      <div className="flex flex-wrap items-start gap-[clamp(30px,5vw,70px)]">
        <ol className="m-0 flex min-w-[min(100%,290px)] flex-[1_1_420px] list-none flex-col gap-[clamp(30px,5vh,58px)] p-0">
          {pasos(sorteo).map((paso) => (
            <Reveal
              key={paso.titulo}
              as="li"
              variante="texto"
              desplazamiento={34}
              duracion={[0.8, 0.8]}
              className={`flex max-w-[440px] items-start gap-5 ${paso.alineacion}`}
            >
              {/* Espacio del ícono editorial del prototipo; los íconos finales están pendientes. */}
              <div
                aria-hidden="true"
                className={`flex size-[76px] flex-none items-center justify-center border border-tinta ${paso.icono}`}
              >
                <span className="text-center text-[8px] leading-[1.3] font-semibold tracking-[.12em] text-placeholder-texto uppercase">
                  Ícono
                  <br />
                  editorial
                </span>
              </div>
              <div>
                <span className={`mb-2 block text-[11px] leading-none font-semibold tracking-[.2em] uppercase ${paso.color}`}>
                  {paso.titulo}
                </span>
                <p className="m-0 text-[15px] leading-[1.5] text-parrafo">{paso.texto}</p>
              </div>
            </Reveal>
          ))}
        </ol>

        <div ref={parallax} className="flex min-w-[min(100%,280px)] flex-[1_1_330px] justify-center">
          {sorteo && <DigitalPassPreview sorteo={sorteo} />}
        </div>
      </div>

      <a
        href="#tickets"
        className="group mt-[clamp(44px,7vh,86px)] inline-flex items-center justify-between gap-[26px] rounded-full bg-tinta px-9 py-6 text-[14px] leading-none font-semibold tracking-[.14em] text-hueso uppercase hover:bg-coral hover:text-hueso"
      >
        Quiero mi ticket
        <span aria-hidden="true" className="inline-block text-[18px] transition-transform duration-300 group-hover:translate-x-[10px]">
          →
        </span>
      </a>
    </section>
  )
}
