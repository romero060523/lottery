import type { Sorteo } from '../../hooks/useSorteos'
import { formatearCOP } from '../../utils/currency'
import { formatearEntero } from '../../utils/number'
import Reveal from './Reveal'
import TramaQr from './TramaQr'

// Los dos estados que puede ver un comprador: el boleto validado y el que
// todavía espera la revisión manual del pago (sección 7 de docs/arquitectura.md).
// Los badges son los mismos que dibuja `RegisterFormPage` al emitir el pase.
const ESTADOS = {
  confirmado: {
    etiqueta: 'Participación confirmada',
    clase: 'bg-tinta text-hueso',
    nota: (edicion: string, tickets: string) =>
      `Ejemplo del pase de la Edición ${edicion} con ${tickets}, tal como lo verás con tu pago validado.`,
  },
  pendiente: {
    etiqueta: 'Pago por validar',
    clase: 'bg-amarillo text-tinta',
    nota: (edicion: string, tickets: string) =>
      `Así se ve un pase de la Edición ${edicion} con ${tickets} mientras una persona revisa tu pago.`,
  },
} as const

type DigitalPassPreviewProps = {
  sorteo: Pick<Sorteo, 'codigo_prefijo' | 'precio_boleto' | 'edicion_numero'>
  /** Sufijo ilustrativo: la secuencia real empieza en 00001 y nunca coincide. */
  sufijo: string
  estado: keyof typeof ESTADOS
  /** Tickets del pase. Por debajo de 4 no hay gratis, así que el monto es precio × tickets. */
  tickets: number
  rotacion: number
  /** Segundos de retraso del Reveal, para escalonar varias tarjetas. */
  retraso?: number
}

/**
 * Pase digital de ejemplo: código, monto, trama y estado. El público no puede
 * leer boletos —RLS no da lectura de `boletos`—, así que estos datos son
 * ilustrativos. El pase real lo dibuja `RegisterFormPage` al terminar la compra.
 */
export default function DigitalPassPreview({
  sorteo,
  sufijo,
  estado,
  tickets,
  rotacion,
  retraso = 0,
}: DigitalPassPreviewProps) {
  const edicion = String(sorteo.edicion_numero).padStart(2, '0')
  const cuantos = `${formatearEntero(tickets)} ${tickets === 1 ? 'ticket' : 'tickets'}`
  const { etiqueta, clase, nota } = ESTADOS[estado]

  return (
    <Reveal
      variante="foto"
      rotacion={rotacion}
      duracion={[1, 1.1]}
      retraso={retraso}
      className="relative w-[min(100%,340px)] border border-tinta bg-hueso p-6 shadow-pase"
    >
      <span className="absolute -top-[13px] left-5 rounded-full bg-morado px-3.5 py-[7px] text-[9px] leading-none font-semibold tracking-[.16em] text-hueso uppercase">
        Tu pase digital
      </span>

      <div className="mt-1.5 flex items-start justify-between gap-4">
        <div>
          <span className="mb-1.5 block text-[9px] leading-none font-semibold tracking-[.18em] text-placeholder-texto uppercase">
            Código
          </span>
          <span className="font-display text-[32px] leading-none tracking-[.01em]">
            {sorteo.codigo_prefijo}-{sufijo}
          </span>
        </div>
        <span className="font-display text-[24px] leading-none text-morado">
          {formatearCOP(sorteo.precio_boleto * tickets)}
          <br />
          <span className="font-sans text-[9px] leading-none font-semibold tracking-[.18em] text-placeholder-texto">COP</span>
        </span>
      </div>

      <div className="my-5 border-t border-dashed border-tinta/45" />

      <div className="flex items-center gap-[18px]">
        <TramaQr />
        <div>
          <span
            className={`inline-block rounded-full px-[13px] py-[7px] text-[9px] leading-none font-semibold tracking-[.14em] uppercase ${clase}`}
          >
            {etiqueta}
          </span>
          <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-parrafo">{nota(edicion, cuantos)}</p>
        </div>
      </div>
    </Reveal>
  )
}
