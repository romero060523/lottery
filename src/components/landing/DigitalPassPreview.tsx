import type { Sorteo } from '../../hooks/useSorteos'
import { formatearCOP } from '../../utils/currency'
import Reveal from './Reveal'

// Trama decorativa del prototipo: 13 × 13 celdas con tres esquinas tipo QR. No
// codifica nada. Se conserva su aritmética en coma flotante para dibujar lo mismo.
const CELDAS_QR = (() => {
  const celdas: boolean[] = []
  let s = 7
  for (let i = 0; i < 169; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    const fila = Math.floor(i / 13)
    const columna = i % 13
    const esquina = (fila < 3 && columna < 3) || (fila < 3 && columna > 9) || (fila > 9 && columna < 3)
    celdas.push(
      esquina
        ? !((fila === 1 && columna !== 1 && columna !== 11) || (columna === 1 && fila !== 1 && fila !== 11))
        : s % 100 > 52,
    )
  }
  return celdas
})()

type DigitalPassPreviewProps = {
  sorteo: Pick<Sorteo, 'codigo_prefijo' | 'precio_boleto' | 'edicion_numero'>
}

/**
 * Pase digital de ejemplo: código, precio, trama y estado. El público no puede
 * leer boletos, así que el código es ilustrativo; la secuencia real empieza en
 * 00001 y este nunca coincide con un pase emitido.
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
        <div
          aria-hidden="true"
          className="grid size-[104px] flex-none grid-cols-[repeat(13,1fr)] grid-rows-[repeat(13,1fr)] gap-px border border-tinta bg-hueso p-1.5"
        >
          {CELDAS_QR.map((encendida, i) => (
            <span key={i} className={encendida ? 'bg-tinta' : undefined} />
          ))}
        </div>
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
