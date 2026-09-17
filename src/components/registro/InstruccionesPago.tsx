import { formatearCOP } from '../../utils/currency'
import { DATOS_COMENTARIO, DATOS_PAGO } from '../../utils/pago'

type InstruccionesPagoProps = {
  /** 'resumen' antes de reservar; 'completa' en el pase, con los datos ya enviados. */
  variante: 'resumen' | 'completa'
  datos?: { nombre: string; documento: string; telefono: string; monto: number }
}

/** Cómo se paga y qué se escribe en el comentario. */
export default function InstruccionesPago({ variante, datos }: InstruccionesPagoProps) {
  const valores = datos ? [datos.nombre, datos.documento, datos.telefono] : []

  return (
    <div>
      {DATOS_PAGO ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border border-tinta bg-hueso p-[18px] text-[13px] leading-[1.4]">
          <dt className="text-[10px] leading-[1.6] font-semibold tracking-[.16em] text-parrafo uppercase">Medio</dt>
          <dd className="m-0 font-semibold text-tinta">{DATOS_PAGO.medio}</dd>
          <dt className="text-[10px] leading-[1.6] font-semibold tracking-[.16em] text-parrafo uppercase">Destinatario</dt>
          <dd className="m-0 font-semibold text-tinta">{DATOS_PAGO.destinatario}</dd>
          <dt className="text-[10px] leading-[1.6] font-semibold tracking-[.16em] text-parrafo uppercase">Número</dt>
          <dd className="m-0 font-semibold text-tinta">{DATOS_PAGO.numero}</dd>
        </dl>
      ) : (
        <p role="status" className="m-0 border-l-4 border-amarillo bg-amarillo/15 px-4 py-3.5 text-[13px] leading-[1.55] text-parrafo">
          Datos de pago por confirmar. El organizador todavía no definió el destinatario ni el número de pago.
        </p>
      )}

      {variante === 'completa' && datos && (
        <p className="mt-4 mb-0 text-[13px] leading-[1.55] text-parrafo">
          Monto a pagar: <strong className="font-semibold text-tinta">{formatearCOP(datos.monto)} COP</strong>.
        </p>
      )}

      <p className="mt-4 mb-3 text-[13px] leading-[1.55] text-parrafo">
        En el <strong className="font-semibold text-tinta">comentario del pago</strong>, escribe únicamente:
      </p>

      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {DATOS_COMENTARIO.map((dato, i) => (
          <li key={dato.titulo} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-7 flex-none items-center justify-center rounded-full bg-morado/15 text-[12px] leading-none font-semibold text-morado"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[13px] leading-[1.4] font-semibold text-tinta">{dato.titulo}</p>
              {valores[i] ? (
                <p className="mt-1 mb-0 border border-tinta/35 bg-hueso px-2.5 py-1.5 text-[13px] leading-[1.4] break-words text-tinta">
                  {valores[i]}
                </p>
              ) : (
                <p className="mt-1 mb-0 text-[12px] leading-[1.5] text-parrafo">{dato.ayuda}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
