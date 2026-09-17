import type { Sorteo } from '../../hooks/useSorteos'
import { formatearCOP } from '../../utils/currency'
import Reveal from './Reveal'
import TramaQr from './TramaQr'

type DigitalPassPreviewProps = {
  sorteo: Pick<Sorteo, 'codigo_prefijo' | 'precio_boleto' | 'edicion_numero'>
}

/**
 * Pase digital de ejemplo: código, precio, trama y estado. El público no puede
 * leer boletos, así que el código es ilustrativo; la secuencia real empieza en
 * 00001 y este nunca coincide con un pase emitido. El pase real lo dibuja
 * `RegisterFormPage` al terminar la compra.
 */
export default function DigitalPassPreview({ sorteo }: DigitalPassPreviewProps) {
  const edicion = String(sorteo.edicion_numero).padStart(2, '0')

  return (
    <Reveal
      variante="foto"
      rotacion={-6}
      duracion={[1, 1.1]}
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
          <span className="font-display text-[32px] leading-none tracking-[.01em]">{sorteo.codigo_prefijo}-00000</span>
        </div>
        <span className="font-display text-[24px] leading-none text-morado">
          {formatearCOP(sorteo.precio_boleto)}
          <br />
          <span className="font-sans text-[9px] leading-none font-semibold tracking-[.18em] text-placeholder-texto">COP</span>
        </span>
      </div>

      <div className="my-5 border-t border-dashed border-tinta/45" />

      <div className="flex items-center gap-[18px]">
        <TramaQr />
        <div>
          <span className="inline-block rounded-full bg-tinta px-[13px] py-[7px] text-[9px] leading-none font-semibold tracking-[.14em] text-hueso uppercase">
            Participación confirmada
          </span>
          <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-parrafo">
            Ejemplo del pase de la Edición {edicion}, tal como lo verás con tu pago validado.
          </p>
        </div>
      </div>
    </Reveal>
  )
}
