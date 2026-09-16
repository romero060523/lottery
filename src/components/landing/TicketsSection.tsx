import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMomentoAlcanzado } from '../../hooks/useMomentoAlcanzado'
import { useMontosTotales, useMontoTotal } from '../../hooks/useMontoTotal'
import { useSorteoActual, type Sorteo } from '../../hooks/useSorteos'
import { formatearCOP } from '../../utils/currency'
import { formatearEntero } from '../../utils/number'
import { estadoVenta, maximoComprable, ticketsRestantes, type EstadoVenta } from '../../utils/tickets'
import Reveal from './Reveal'

const QUICK_PICKS = [
  { cantidad: 1, clases: 'rotate-[-3deg] bg-amarillo text-tinta enabled:hover:bg-hueso' },
  { cantidad: 3, clases: 'rotate-[2deg] bg-azul text-hueso enabled:hover:bg-hueso enabled:hover:text-tinta' },
  { cantidad: 5, clases: 'rotate-[-2deg] bg-morado text-hueso enabled:hover:bg-coral' },
] as const

const formatoFecha = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
})

const plural = (n: number, singular: string, plural: string) => `${formatearEntero(n)} ${n === 1 ? singular : plural}`

/** Selector de cantidad + quick-picks + total. */
export default function TicketsSection() {
  const { data: sorteo, isPending, isError } = useSorteoActual()

  let contenido = null
  if (isError) {
    contenido = <Aviso titulo="Sin conexión">No pudimos cargar el sorteo. Intenta de nuevo en unos minutos.</Aviso>
  } else if (!isPending && !sorteo) {
    contenido = <Aviso titulo="Sin sorteo activo">No hay sorteos activos en este momento.</Aviso>
  } else if (sorteo) {
    // key: cambiar de edición reinicia la cantidad elegida.
    contenido = <TicketsContenido key={sorteo.id} sorteo={sorteo} />
  }

  return (
    <section
      id="tickets"
      data-cursor-color="var(--color-amarillo)"
      aria-busy={isPending}
      className="relative bg-tinta px-lateral py-seccion text-hueso"
    >
      <Reveal
        as="h2"
        variante="texto"
        desplazamiento={50}
        duracion={[0.9, 1]}
        className="texto-outline m-0 mb-[clamp(40px,6vh,72px)] font-display text-[clamp(52px,14vw,210px)] leading-[.86] tracking-[-.025em] uppercase"
      >
        Elige tu suerte.
      </Reveal>
      {contenido}
    </section>
  )
}

function TicketsContenido({ sorteo }: { sorteo: Sorteo }) {
  const iniciada = useMomentoAlcanzado(sorteo.fecha_inicio_ventas)
  const finalizada = useMomentoAlcanzado(sorteo.fecha_fin_ventas)
  // Se recalcula con cada refetch del sorteo: otra compra puede agotar el cupo.
  const maximo = maximoComprable(sorteo)
  const estado = estadoVenta({ activo: sorteo.activo, iniciada, finalizada, maximo })

  if (estado !== 'disponible') return <VentaNoDisponible estado={estado} sorteo={sorteo} />
  return <SelectorTickets sorteo={sorteo} maximo={maximo} />
}

function SelectorTickets({ sorteo, maximo }: { sorteo: Sorteo; maximo: number }) {
  const [cantidadElegida, setCantidadElegida] = useState(1)
  // Si el cupo baja mientras la página está abierta, la cantidad se ajusta sola.
  const cantidad = Math.min(Math.max(cantidadElegida, 1), maximo)

  const total = useMontoTotal(cantidad, sorteo.precio_boleto)
  const quickPicks = useMontosTotales(
    QUICK_PICKS.map((pick) => pick.cantidad),
    sorteo.precio_boleto,
  )

  // Solo se puede continuar con el total de ESTA cantidad, no con el anterior en pantalla.
  const totalActual = total.data && !total.isPlaceholderData && total.data.cantidad_comprada === cantidad ? total.data : null
  const restantes = ticketsRestantes(sorteo)
  const limitadoPorCupo = maximo < sorteo.max_tickets_por_compra

  return (
    <div className="flex flex-wrap items-start gap-[clamp(30px,5vw,70px)]">
      <div className="min-w-[min(100%,290px)] flex-[1_1_380px]">
        <span id="tickets-cantidad" className="mb-[18px] block text-[10px] leading-none font-semibold tracking-[.2em] text-hueso/65 uppercase">
          Cantidad de tickets
        </span>
        <div role="group" aria-labelledby="tickets-cantidad" className="mb-[34px] flex items-center gap-5">
          <button
            type="button"
            aria-label="Quitar un ticket"
            disabled={cantidad <= 1}
            onClick={() => setCantidadElegida(cantidad - 1)}
            className="size-16 cursor-pointer rounded-full border border-hueso/55 bg-transparent text-[26px] leading-none text-hueso enabled:hover:bg-hueso enabled:hover:text-tinta disabled:cursor-not-allowed disabled:opacity-30"
          >
            −
          </button>
          <output aria-live="polite" className="min-w-[2.2ch] text-center font-display text-[clamp(64px,11vw,124px)] leading-[.9]">
            {cantidad}
          </output>
          <button
            type="button"
            aria-label="Agregar un ticket"
            disabled={cantidad >= maximo}
            onClick={() => setCantidadElegida(cantidad + 1)}
            className="size-16 cursor-pointer rounded-full border border-hueso/55 bg-transparent text-[26px] leading-none text-hueso enabled:hover:border-morado enabled:hover:bg-morado enabled:hover:text-hueso disabled:cursor-not-allowed disabled:opacity-30"
          >
            +
          </button>
        </div>

        <div className="flex flex-wrap gap-3">
          {QUICK_PICKS.map((pick, i) => {
            const monto = quickPicks[i].data
            return (
              <button
                key={pick.cantidad}
                type="button"
                disabled={pick.cantidad > maximo}
                aria-pressed={cantidad === pick.cantidad}
                onClick={() => setCantidadElegida(pick.cantidad)}
                className={`cursor-pointer rounded-[6px] border border-tinta px-[18px] py-3.5 text-[11px] leading-none font-semibold tracking-[.14em] uppercase disabled:cursor-not-allowed disabled:opacity-35 ${pick.clases}`}
              >
                {plural(pick.cantidad, 'ticket', 'tickets')}
                {monto && monto.tickets_gratis > 0 && ` + ${formatearEntero(monto.tickets_gratis)} gratis`}
                {monto && ` · ${formatearCOP(monto.monto_total)} COP`}
              </button>
            )
          })}
        </div>

        <p className="mt-6 mb-0 text-[10px] leading-[1.6] font-semibold tracking-[.2em] text-hueso/65 uppercase">
          Por cada 4 tickets comprados, 1 gratis ·{' '}
          {limitadoPorCupo
            ? `Quedan ${plural(restantes, 'ticket', 'tickets')}: hasta ${formatearEntero(maximo)} por compra, contando los gratis`
            : `Hasta ${formatearEntero(maximo)} por compra`}
        </p>
      </div>

      <div className="min-w-[min(100%,280px)] flex-[1_1_340px] border-t border-hueso/30 pt-[26px]">
        <span className="mb-2.5 block text-[10px] leading-none font-semibold tracking-[.2em] text-hueso/65 uppercase">
          Total a pagar
        </span>
        <div
          aria-live="polite"
          className={`font-display text-[clamp(52px,9vw,110px)] leading-[.9] tracking-[-.01em] text-amarillo transition-opacity duration-200 ease-[ease] ${totalActual ? '' : 'opacity-50'}`}
        >
          {total.data ? `${formatearCOP(total.data.monto_total)} COP` : '—'}
        </div>
        <p className="mt-3.5 mb-[26px] text-[12px] leading-[1.5] text-hueso/70">
          {total.isError
            ? 'No pudimos calcular el total. Intenta de nuevo en unos segundos.'
            : totalActual && totalActual.tickets_gratis > 0
              ? `Recibes ${plural(totalActual.cantidad_total, 'ticket', 'tickets')}: ${formatearEntero(totalActual.cantidad_comprada)} comprados + ${formatearEntero(totalActual.tickets_gratis)} gratis. `
              : ''}
          {!total.isError && 'Tu compra genera un pase digital con un código único.'}
        </p>

        {totalActual ? (
          <Link
            // RegisterFormPage completa la compra y vuelve a validar todo con comprar_tickets.
            to={`/registro?sorteo=${sorteo.id}&cantidad=${cantidad}`}
            className="group flex w-full items-center justify-between gap-5 rounded-full bg-morado px-8 py-6 text-[13px] leading-none font-semibold tracking-[.14em] text-hueso uppercase hover:bg-hueso hover:text-tinta"
          >
            Continuar al pago
            <span aria-hidden="true" className="inline-block text-[17px] transition-transform duration-300 group-hover:translate-x-[10px]">
              →
            </span>
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-between gap-5 rounded-full bg-morado px-8 py-6 text-[13px] leading-none font-semibold tracking-[.14em] text-hueso uppercase opacity-50"
          >
            {total.isError ? 'Total no disponible' : 'Calculando total'}
            <span aria-hidden="true" className="text-[17px]">
              →
            </span>
          </button>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {['Pago seguro', 'Ticket único', 'Resultado público'].map((sello) => (
            <span
              key={sello}
              className="rounded-full border border-hueso/45 px-[13px] py-2 text-[9px] leading-none font-medium tracking-[.16em] text-hueso/85 uppercase"
            >
              {sello}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const TEXTOS_NO_DISPONIBLE: Record<Exclude<EstadoVenta, 'disponible'>, (sorteo: Sorteo) => { titulo: string; texto: string }> = {
  agotada: (sorteo) => ({
    titulo: 'Edición agotada',
    texto: `Los ${formatearEntero(sorteo.tickets_totales)} tickets de la Edición ${String(sorteo.edicion_numero).padStart(2, '0')} están reservados. Si una reserva vence sin pagarse, su cupo vuelve a quedar disponible.`,
  }),
  no_iniciada: (sorteo) => ({
    titulo: 'Muy pronto',
    texto: `La venta abre el ${formatoFecha.format(new Date(sorteo.fecha_inicio_ventas))} (hora de Colombia).`,
  }),
  cerrada: (sorteo) => ({
    titulo: 'Venta cerrada',
    texto: sorteo.fecha_fin_ventas
      ? `La venta de esta edición terminó el ${formatoFecha.format(new Date(sorteo.fecha_fin_ventas))} (hora de Colombia).`
      : 'La venta de esta edición no está habilitada.',
  }),
}

/** Sin selector ni CTA: no se ofrece una compra que comprar_tickets rechazaría. */
function VentaNoDisponible({ estado, sorteo }: { estado: Exclude<EstadoVenta, 'disponible'>; sorteo: Sorteo }) {
  const { titulo, texto } = TEXTOS_NO_DISPONIBLE[estado](sorteo)
  return <Aviso titulo={titulo}>{texto}</Aviso>
}

function Aviso({ titulo, children }: { titulo: string; children: string }) {
  return (
    <div role="status" className="max-w-[620px] border-t border-hueso/30 pt-[26px]">
      <p className="m-0 font-display text-[clamp(40px,7vw,84px)] leading-[.9] tracking-[-.01em] text-amarillo uppercase">
        {titulo}
      </p>
      <p className="mt-3.5 mb-0 text-[15px] leading-[1.55] text-hueso/70">{children}</p>
    </div>
  )
}
