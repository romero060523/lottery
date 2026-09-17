import { Link } from 'react-router-dom'
import { formatearEntero } from '../../utils/number'

/** La revisión del pago es manual: aquí se dice cuándo aparece la reserva. */
export default function CuandoVerasTickets({ ttlHoras }: { ttlHoras: number }) {
  return (
    <div className="border border-morado/40 bg-morado/10 p-[22px]">
      <p className="m-0 mb-2.5 font-display text-[clamp(22px,4vw,30px)] leading-[.95] tracking-[-.01em] text-tinta uppercase">
        ¿Cuándo verás tus tickets?
      </p>
      <p className="m-0 mb-5 text-[13px] leading-[1.55] text-parrafo">
        Tu reserva queda pendiente hasta que una persona valide tu pago. El cupo se guarda{' '}
        {formatearEntero(ttlHoras)} {ttlHoras === 1 ? 'hora' : 'horas'}; después, si no alcanzamos a validarlo, vuelve a
        quedar disponible.
      </p>
      <Link
        to="/consulta"
        className="group flex items-center justify-between gap-5 rounded-full bg-morado px-7 py-4 text-[12px] leading-none font-semibold tracking-[.14em] text-hueso uppercase hover:bg-tinta"
      >
        Consultar mis tickets
        <span aria-hidden="true" className="inline-block text-[15px] transition-transform duration-300 group-hover:translate-x-[6px]">
          ↗
        </span>
      </Link>
    </div>
  )
}
