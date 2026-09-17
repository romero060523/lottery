import { zodResolver } from '@hookform/resolvers/zod'
import type { PostgrestError } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router-dom'
import TramaQr from '../components/landing/TramaQr'
import AvisoEdad from '../components/registro/AvisoEdad'
import CuandoVerasTickets from '../components/registro/CuandoVerasTickets'
import InstruccionesPago from '../components/registro/InstruccionesPago'
import ResumenTotal from '../components/registro/ResumenTotal'
import SelectorCantidad from '../components/registro/SelectorCantidad'
import SelectorPaquetes from '../components/registro/SelectorPaquetes'
import { useComprarTickets, type ArgsCompra, type BoletoEmitido } from '../hooks/useComprarTickets'
import { useMomentoAlcanzado } from '../hooks/useMomentoAlcanzado'
import { useMontoTotal } from '../hooks/useMontoTotal'
import { useSorteoPorId, type Sorteo } from '../hooks/useSorteos'
import { formatearCOP } from '../utils/currency'
import { formatearEntero } from '../utils/number'
import { esquemaRegistro, TIPOS_DOCUMENTO, type DatosRegistro } from '../utils/registro'
import { estadoVenta, maximoComprable, ticketsRestantes, type EstadoVenta } from '../utils/tickets'

const formatoFecha = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'America/Bogota',
})

const plural = (n: number, singular: string, plural: string) => `${formatearEntero(n)} ${n === 1 ? singular : plural}`
const horas = (n: number) => `${formatearEntero(n)} ${n === 1 ? 'hora' : 'horas'}`
const edicionDe = (sorteo: Sorteo) => String(sorteo.edicion_numero).padStart(2, '0')

/** El `?cantidad=` del CTA es una sugerencia: solo se acepta si es un entero positivo. */
function enteroDeParametro(valor: string | null): number | null {
  if (!valor || !/^\d+$/.test(valor)) return null
  const numero = Number(valor)
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null
}

/**
 * Registro público: la primera pantalla que llama a `comprar_tickets`, la RPC
 * que reserva cupo de verdad (sección 3 de docs/arquitectura.md). Llega desde
 * la landing con `?sorteo=` y, si viene, `?cantidad=`, pero no se fía de ninguno:
 * entre ver el precio y enviar el formulario la edición pudo agotarse, cerrar
 * ventas o entrar en pausa, así que el estado se vuelve a derivar del sorteo
 * recién leído y el servidor lo valida otra vez al reservar.
 */
export default function RegisterFormPage() {
  const [parametros] = useSearchParams()
  const sorteoId = parametros.get('sorteo')
  const cantidadPedida = enteroDeParametro(parametros.get('cantidad'))
  const { data: sorteo, isPending, isError } = useSorteoPorId(sorteoId)

  let contenido = null
  if (isError) {
    contenido = <Aviso titulo="Sin conexión">No pudimos cargar el sorteo. Intenta de nuevo en unos minutos.</Aviso>
  } else if (!isPending && !sorteo) {
    contenido = sorteoId ? (
      <Aviso titulo="Edición no disponible">
        El enlace apunta a una edición que ya no está activa. Vuelve al inicio para ver la edición en venta.
      </Aviso>
    ) : (
      <Aviso titulo="Sin sorteo activo">No hay sorteos activos en este momento.</Aviso>
    )
  } else if (sorteo) {
    // key: cambiar de edición reinicia el formulario y el resultado de la compra.
    contenido = <Registro key={sorteo.id} sorteo={sorteo} cantidadPedida={cantidadPedida} />
  }

  return (
    <div aria-busy={isPending}>
      {contenido}
      <Link
        to="/"
        className="mt-[clamp(40px,6vh,72px)] inline-block text-[11px] leading-none font-semibold tracking-[.2em] text-parrafo uppercase hover:text-coral"
      >
        ← Volver al sorteo
      </Link>
    </div>
  )
}

function Registro({ sorteo, cantidadPedida }: { sorteo: Sorteo; cantidadPedida: number | null }) {
  // Los mismos timers y el mismo cálculo de tope que usa el selector: la
  // apertura y el cierre de ventas se aplican a la hora exacta sin recargar.
  const iniciada = useMomentoAlcanzado(sorteo.fecha_inicio_ventas)
  const finalizada = useMomentoAlcanzado(sorteo.fecha_fin_ventas)
  const maximo = maximoComprable(sorteo)
  const estado = estadoVenta({ activo: sorteo.activo, iniciada, finalizada, maximo })
  const compra = useComprarTickets()

  if (compra.data) return <PaseEmitido boleto={compra.data} sorteo={sorteo} enviado={compra.variables} />

  return (
    <>
      <span className="mb-[18px] block text-[11px] leading-none font-semibold tracking-[.2em] text-morado uppercase">
        Edición {edicionDe(sorteo)} · {sorteo.nombre}
      </span>
      <span className="mb-4 inline-block rounded-full border border-tinta bg-amarillo px-[13px] py-2 text-[9px] leading-none font-semibold tracking-[.16em] text-tinta uppercase">
        Un solo paso
      </span>
      <h1 className="m-0 mb-[clamp(20px,3vh,32px)] max-w-[16ch] font-display text-[clamp(34px,6vw,84px)] leading-[.88] tracking-[-.02em] uppercase">
        Reserva tu pase.
      </h1>

      <AvisoEdad />

      <p className="mt-[22px] mb-[clamp(24px,4vh,38px)] text-[15px] leading-[1.55] text-parrafo">
        Elige cuántos tickets quieres, deja tus datos y reserva tu cupo. Por cada 4 tickets comprados, 1 gratis.
      </p>

      {/* El error explica el envío que falló; el aviso de abajo, en qué estado
          quedó la venta. Los dos hacen falta: pueden no coincidir. */}
      {compra.error && (
        <ErrorDeCompra
          error={compra.error}
          sorteo={sorteo}
          estado={estado}
          maximo={maximo}
          cantidadEnviada={compra.variables?.p_cantidad}
        />
      )}

      {estado === 'disponible' ? (
        <Formulario
          sorteo={sorteo}
          maximo={maximo}
          cantidadPedida={cantidadPedida}
          enVuelo={compra.isPending}
          onEnviar={compra.reservar}
        />
      ) : (
        <VentaNoDisponible estado={estado} sorteo={sorteo} />
      )}
    </>
  )
}

type FormularioProps = {
  sorteo: Sorteo
  maximo: number
  cantidadPedida: number | null
  enVuelo: boolean
  onEnviar: (args: ArgsCompra) => void
}

function Formulario({ sorteo, maximo, cantidadPedida, enVuelo, onEnviar }: FormularioProps) {
  // El esquema se rehace cuando baja el cupo: su tope de cantidad es el de ahora.
  const esquema = useMemo(() => esquemaRegistro(maximo), [maximo])
  const {
    control,
    register,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<DatosRegistro>({
    resolver: zodResolver(esquema),
    defaultValues: {
      nombre_comprador: '',
      telefono: '',
      tipo_documento: 'cedula',
      numero_documento: '',
      cantidad: Math.min(cantidadPedida ?? 1, maximo),
    },
  })

  // El total se recalcula con lo que hay escrito, así que la cantidad se
  // observa como suscripción (useWatch) y no con el `watch` del formulario.
  const cantidad = useWatch({ control, name: 'cantidad' })
  // Solo se consulta el total de una cantidad que la RPC aceptaría: así no se
  // le piden a `calcular_monto_total` valores que rechazaría (22003) mientras
  // se escribe. El campo ya muestra su propio error de validación.
  const cantidadValida = Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= maximo
  const total = useMontoTotal(cantidadValida ? cantidad : 0, sorteo.precio_boleto)
  const totalActual = total.data && !total.isPlaceholderData && total.data.cantidad_comprada === cantidad ? total.data : null
  const cupoAjustado = cantidadPedida !== null && cantidadPedida > maximo
  const elegirCantidad = (nueva: number) => setValue('cantidad', nueva, { shouldValidate: true })

  // `enVuelo` deshabilita el botón, que es lo que frena el doble clic. El
  // pestillo contra los envíos que se adelantan a ese render lo pone
  // `useComprarTickets`, que es quien conoce el estado real de la llamada.
  const enviar = handleSubmit((datos) => {
    onEnviar({
      p_sorteo_id: sorteo.id,
      p_cantidad: datos.cantidad,
      p_nombre_comprador: datos.nombre_comprador,
      p_telefono: datos.telefono,
      p_tipo_documento: datos.tipo_documento,
      p_numero_documento: datos.numero_documento,
    })
  })

  return (
    // noValidate: los mensajes los da Zod, no los globos del navegador.
    <form noValidate onSubmit={enviar} className="flex flex-col gap-[26px]">
      <SelectorPaquetes precio={sorteo.precio_boleto} maximo={maximo} cantidad={cantidad} onElegir={elegirCantidad} />

      <SelectorCantidad
        cantidad={cantidad}
        maximo={maximo}
        enVuelo={enVuelo}
        onCambiar={elegirCantidad}
        error={errors.cantidad?.message}
        ayuda={
          cupoAjustado
            ? `Pediste ${plural(cantidadPedida, 'ticket', 'tickets')} y ahora solo caben ${formatearEntero(maximo)} por compra: ajustamos la cantidad.`
            : `Por cada 4 tickets comprados, 1 gratis. Hasta ${formatearEntero(maximo)} por compra.`
        }
      >
        <input
          id="cantidad"
          aria-describedby="cantidad-nota"
          type="number"
          inputMode="numeric"
          step={1}
          min={1}
          max={maximo}
          disabled={enVuelo}
          aria-invalid={errors.cantidad ? true : undefined}
          className="w-full min-w-0 border-y border-tinta bg-hueso px-3 py-3.5 text-center font-display text-[24px] leading-none text-tinta outline-none focus-visible:border-morado disabled:opacity-60 aria-invalid:border-coral"
          {...register('cantidad', { valueAsNumber: true })}
        />
      </SelectorCantidad>

      <ResumenTotal
        precio={sorteo.precio_boleto}
        cantidad={cantidad}
        cantidadValida={cantidadValida}
        monto={total.data}
        montoConfirmado={totalActual}
        error={total.isError}
      />

      <InstruccionesPago variante="resumen" />

      <h2 className="m-0 mt-2 font-display text-[clamp(22px,4vw,30px)] leading-[.95] tracking-[-.01em] uppercase">Tus datos</h2>

      <Campo etiqueta="Nombre completo" error={errors.nombre_comprador?.message} id="nombre_comprador">
        <input
          id="nombre_comprador"
          aria-describedby="nombre_comprador-nota"
          type="text"
          autoComplete="name"
          maxLength={200}
          disabled={enVuelo}
          aria-invalid={errors.nombre_comprador ? true : undefined}
          className={CLASES_CAMPO}
          {...register('nombre_comprador')}
        />
      </Campo>

      <Campo
        etiqueta="Teléfono"
        error={errors.telefono?.message}
        id="telefono"
        ayuda="Es la única forma de contactarte por tu reserva."
      >
        <input
          id="telefono"
          aria-describedby="telefono-nota"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={32}
          disabled={enVuelo}
          aria-invalid={errors.telefono ? true : undefined}
          className={CLASES_CAMPO}
          {...register('telefono')}
        />
      </Campo>

      <Campo etiqueta="Tipo de documento" error={errors.tipo_documento?.message} id="tipo_documento">
        <select
          id="tipo_documento"
          aria-describedby="tipo_documento-nota"
          disabled={enVuelo}
          aria-invalid={errors.tipo_documento ? true : undefined}
          className={CLASES_CAMPO}
          {...register('tipo_documento')}
        >
          {TIPOS_DOCUMENTO.map((tipo) => (
            <option key={tipo.valor} value={tipo.valor}>
              {tipo.etiqueta}
            </option>
          ))}
        </select>
      </Campo>

      <Campo etiqueta="Número de documento" error={errors.numero_documento?.message} id="numero_documento">
        <input
          id="numero_documento"
          aria-describedby="numero_documento-nota"
          type="text"
          inputMode="numeric"
          maxLength={32}
          disabled={enVuelo}
          aria-invalid={errors.numero_documento ? true : undefined}
          className={CLASES_CAMPO}
          {...register('numero_documento')}
        />
      </Campo>

      <button
        type="submit"
        disabled={enVuelo}
        className="group flex w-full items-center justify-between gap-5 rounded-full bg-morado px-8 py-6 text-[13px] leading-none font-semibold tracking-[.14em] text-hueso uppercase enabled:cursor-pointer enabled:hover:bg-tinta disabled:cursor-progress disabled:opacity-60"
      >
        {enVuelo ? 'Reservando tus tickets' : 'Reservar mis tickets'}
        <span
          aria-hidden="true"
          className="inline-block text-[17px] transition-transform duration-300 group-enabled:group-hover:translate-x-[10px]"
        >
          →
        </span>
      </button>

      <CuandoVerasTickets ttlHoras={sorteo.ttl_pendientes_horas} />

      <p className="m-0 text-[11px] leading-[1.6] text-parrafo">
        Guarda el comprobante de tu pago. Los tickets se registran después de que una persona revisa el pago: no hay
        confirmación automática, no enviamos nada por correo y este cálculo no confirma una compra.
      </p>
    </form>
  )
}

const CLASES_CAMPO =
  'w-full rounded-[6px] border border-tinta bg-hueso px-4 py-3.5 text-[15px] leading-[1.4] text-tinta outline-none focus-visible:border-morado focus-visible:ring-1 focus-visible:ring-morado disabled:opacity-60 aria-invalid:border-coral'

type CampoProps = {
  id: string
  etiqueta: string
  error?: string
  ayuda?: string
  children: React.ReactNode
}

/**
 * Etiqueta + campo + una sola nota debajo: el error si lo hay, y si no la
 * ayuda. Las dos comparten el id `<campo>-nota`, al que apunta el
 * `aria-describedby` del input; si no hay ninguna, el navegador ignora la
 * referencia.
 */
function Campo({ id, etiqueta, error, ayuda, children }: CampoProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2.5 block text-[10px] leading-none font-semibold tracking-[.2em] text-parrafo uppercase">
        {etiqueta}
      </label>
      {children}
      {error ? (
        <p id={`${id}-nota`} role="alert" className="mt-2 mb-0 text-[12px] leading-[1.5] font-medium text-coral">
          {error}
        </p>
      ) : (
        ayuda && (
          <p id={`${id}-nota`} className="mt-2 mb-0 text-[11px] leading-[1.6] text-parrafo">
            {ayuda}
          </p>
        )
      )}
    </div>
  )
}

type ContextoDeError = {
  sorteo: Sorteo
  estado: EstadoVenta
  maximo: number
  /** La cantidad que se envió, no la que está en pantalla. */
  cantidadEnviada: number | undefined
}

/**
 * Cada código de `comprar_tickets` pide una acción distinta del comprador, así
 * que ninguno comparte mensaje (tabla de códigos en la sección 2 de
 * docs/arquitectura.md; se discrimina por `code`, nunca por el texto del
 * mensaje). `P0001` cubre tres situaciones en el servidor —cupo, ventana de
 * ventas y desborde del monto—, así que se reparte con el estado del sorteo,
 * que la mutación ya volvió a leer al invalidar la query.
 *
 * El único caso en que no se puede afirmar que no se creó el boleto es el fetch
 * que nunca recibió respuesta: `comprar_tickets` reserva e inserta en la misma
 * transacción, así que un error **del servidor** revierte las dos cosas.
 */
function mensajeDeError(error: PostgrestError, { sorteo, estado, maximo, cantidadEnviada }: ContextoDeError) {
  // Sin `code` el fetch falló en el navegador y el servidor no llegó a responder.
  if (!error.code) {
    return {
      titulo: 'No pudimos confirmar tu reserva',
      texto:
        'Se perdió la conexión antes de que el servidor respondiera, así que no sabemos si la reserva quedó registrada. Si vuelves a enviar y la primera sí pasó, quedarás con dos boletos.',
    }
  }

  switch (error.code) {
    case 'P1001':
      return {
        titulo: 'Pediste más de lo permitido',
        texto: `Esta edición admite hasta ${plural(sorteo.max_tickets_por_compra, 'ticket', 'tickets')} por compra. Baja la cantidad y vuelve a enviar: no se creó ningún boleto.`,
      }

    case 'P1004':
      return {
        titulo: 'Venta en pausa',
        texto:
          'Estamos revisando las reservas de esta edición y la venta queda cerrada hasta terminar. No se creó ningún boleto ni se reservó cupo. Vuelve a intentarlo más tarde.',
      }

    case 'P0001':
      if (estado === 'agotada') {
        return {
          titulo: 'Se agotó el cupo',
          texto:
            'Otra compra se llevó los últimos tickets mientras enviabas tus datos. No se creó ningún boleto. Si una reserva vence sin pagarse, su cupo vuelve a quedar disponible.',
        }
      }
      if (estado === 'no_iniciada') {
        return {
          titulo: 'La venta todavía no abre',
          texto: `La venta de esta edición abre el ${formatoFecha.format(new Date(sorteo.fecha_inicio_ventas))} (hora de Colombia). No se creó ningún boleto.`,
        }
      }
      if (estado === 'cerrada') {
        return {
          titulo: 'Venta cerrada',
          texto: sorteo.fecha_fin_ventas
            ? `La venta de esta edición terminó el ${formatoFecha.format(new Date(sorteo.fecha_fin_ventas))} (hora de Colombia). No se creó ningún boleto.`
            : 'La venta de esta edición dejó de estar habilitada. No se creó ningún boleto.',
        }
      }
      if (cantidadEnviada !== undefined && cantidadEnviada > maximo) {
        return {
          titulo: 'Ya no queda cupo para esa cantidad',
          texto: `Pediste ${plural(cantidadEnviada, 'ticket', 'tickets')} y quedan ${plural(ticketsRestantes(sorteo), 'ticket', 'tickets')}: contando los gratis solo caben ${formatearEntero(maximo)} por compra. Baja la cantidad y vuelve a enviar.`,
        }
      }
      return {
        titulo: 'No pudimos reservar',
        texto:
          'El cupo o la ventana de ventas cambió justo al enviar. No se creó ningún boleto: revisa la cantidad y vuelve a intentarlo.',
      }

    case '22003':
    case '22023':
      return {
        titulo: 'Datos rechazados',
        texto: 'El servidor no aceptó los datos enviados. Revisa el nombre, el teléfono, el documento y la cantidad.',
      }

    // `statement_timeout` del rol anon (3 s): la compra esperó el lock del
    // sorteo más de lo permitido. La sentencia se canceló, así que no vendió.
    case '57014':
      return {
        titulo: 'La reserva tardó demasiado',
        texto:
          'La base de datos canceló la operación por tiempo, así que no se creó ningún boleto. Vuelve a intentarlo en unos segundos.',
      }

    default:
      return {
        titulo: 'No pudimos completar la compra',
        texto: `El servidor respondió con un error inesperado (${error.code}). Vuelve a intentarlo; si sigue pasando, avísanos con ese código.`,
      }
  }
}

function ErrorDeCompra({ error, ...contexto }: { error: PostgrestError } & ContextoDeError) {
  const { titulo, texto } = mensajeDeError(error, contexto)

  return (
    <div role="alert" className="mb-[30px] border border-coral bg-coral/10 p-[22px]">
      <p className="m-0 mb-2 font-display text-[clamp(22px,4vw,32px)] leading-[.95] tracking-[-.01em] text-coral uppercase">
        {titulo}
      </p>
      <p className="m-0 text-[13px] leading-[1.55] text-parrafo">{texto}</p>
    </div>
  )
}

/**
 * Pase emitido: el código real que generó el trigger y el total de tickets,
 * comprados más gratis. No se promete confirmación inmediata ni envío por
 * correo, porque el sistema no hace ninguna de las dos (sección 7 de
 * docs/arquitectura.md): la revisión del pago es manual y no se guarda correo.
 */
function PaseEmitido({ boleto, sorteo, enviado }: { boleto: BoletoEmitido; sorteo: Sorteo; enviado: ArgsCompra | undefined }) {
  // `cantidad_total` es una columna generada; si el tipo la da como nula, se
  // recompone con los dos sumandos que la definen.
  const cantidadTotal = boleto.cantidad_total ?? boleto.cantidad_comprada + boleto.cantidad_gratis

  // El formulario desaparece al reservar, así que el foco quedaría en el body:
  // se lleva al título para que un lector de pantalla anuncie el resultado.
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])

  return (
    <>
      <span className="mb-[18px] block text-[11px] leading-none font-semibold tracking-[.2em] text-morado uppercase">
        Edición {edicionDe(sorteo)} · Reserva registrada
      </span>
      {/* Sin tildes a propósito: con el line-height que el sistema de diseño
          pide para Anton (.84–.92), el acento de una mayúscula acentuada se
          sale de su línea y choca con la de arriba. En un título de una sola
          línea no pasa, pero este envuelve. */}
      <h1
        ref={titulo}
        tabIndex={-1}
        className="m-0 mb-[clamp(28px,4vh,44px)] max-w-[16ch] font-display text-[clamp(34px,6vw,84px)] leading-[.88] tracking-[-.02em] uppercase outline-none"
      >
        Guarda tu pase.
      </h1>

      <div className="relative w-[min(100%,340px)] border border-tinta bg-hueso p-6 shadow-pase">
        <span className="absolute -top-[13px] left-5 rounded-full bg-morado px-3.5 py-[7px] text-[9px] leading-none font-semibold tracking-[.16em] text-hueso uppercase">
          Tu pase digital
        </span>

        <div className="mt-1.5 flex items-start justify-between gap-4">
          <div>
            <span className="mb-1.5 block text-[9px] leading-none font-semibold tracking-[.18em] text-placeholder-texto uppercase">
              Código
            </span>
            <span className="font-display text-[32px] leading-none tracking-[.01em]">{boleto.codigo}</span>
          </div>
          <span className="font-display text-[24px] leading-none text-morado">
            {formatearCOP(boleto.monto_total)}
            <br />
            <span className="font-sans text-[9px] leading-none font-semibold tracking-[.18em] text-placeholder-texto">
              COP
            </span>
          </span>
        </div>

        <div className="my-5 border-t border-dashed border-tinta/45" />

        <div className="flex items-center gap-[18px]">
          <TramaQr />
          <div>
            <span className="inline-block rounded-full bg-amarillo px-[13px] py-[7px] text-[9px] leading-none font-semibold tracking-[.14em] text-tinta uppercase">
              Pago por validar
            </span>
            <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-parrafo">
              {boleto.cantidad_gratis > 0
                ? `Participas con ${plural(cantidadTotal, 'ticket', 'tickets')}: ${formatearEntero(boleto.cantidad_comprada)} comprados + ${formatearEntero(boleto.cantidad_gratis)} gratis.`
                : `Participas con ${plural(cantidadTotal, 'ticket', 'tickets')}.`}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-[clamp(28px,4vh,44px)] border-t border-tinta/35 pt-[22px]">
        <h2 className="m-0 mb-4 font-display text-[clamp(22px,4vw,30px)] leading-[.95] tracking-[-.01em] uppercase">
          Cómo pagar
        </h2>
        <InstruccionesPago
          variante="completa"
          datos={
            enviado && {
              nombre: enviado.p_nombre_comprador,
              documento: enviado.p_numero_documento,
              telefono: enviado.p_telefono,
              monto: boleto.monto_total,
            }
          }
        />
      </div>

      <div className="mt-[clamp(24px,4vh,36px)]">
        <CuandoVerasTickets ttlHoras={sorteo.ttl_pendientes_horas} />
      </div>

      <div className="mt-[clamp(28px,4vh,44px)] border-t border-tinta/35 pt-[22px]">
        <p className="m-0 mb-4 text-[15px] leading-[1.55] text-parrafo">
          Tu cupo queda reservado {horas(sorteo.ttl_pendientes_horas)} mientras validamos el pago. Si en ese plazo no
          alcanzamos a validarlo, la reserva se libera y los tickets vuelven a estar disponibles para otras personas.
        </p>
        <p className="m-0 mb-4 text-[15px] leading-[1.55] text-parrafo">
          La revisión la hace una persona, no es automática: <strong className="font-semibold">no hay confirmación
          inmediata</strong> y <strong className="font-semibold">no enviamos el código por correo</strong>. Anótalo o
          toma una captura de esta pantalla ahora — es el único registro que te queda de la reserva.
        </p>
        <p className="m-0 text-[11px] leading-[1.6] text-parrafo">
          El código {boleto.codigo} identifica esta reserva, no acredita identidad ni sirve como contraseña.
        </p>
      </div>
    </>
  )
}

const TEXTOS_NO_DISPONIBLE: Record<Exclude<EstadoVenta, 'disponible'>, (sorteo: Sorteo) => { titulo: string; texto: string }> = {
  agotada: (sorteo) => ({
    titulo: 'Edición agotada',
    texto: `Los ${formatearEntero(sorteo.tickets_totales)} tickets de la Edición ${edicionDe(sorteo)} están reservados. Si una reserva vence sin pagarse, su cupo vuelve a quedar disponible.`,
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

/** Sin formulario: no se piden datos para una compra que `comprar_tickets` rechazaría. */
function VentaNoDisponible({ estado, sorteo }: { estado: Exclude<EstadoVenta, 'disponible'>; sorteo: Sorteo }) {
  const { titulo, texto } = TEXTOS_NO_DISPONIBLE[estado](sorteo)
  return <Aviso titulo={titulo}>{texto}</Aviso>
}

function Aviso({ titulo, children }: { titulo: string; children: string }) {
  return (
    <div role="status" className="border-t border-tinta/35 pt-[26px]">
      <p className="m-0 font-display text-[clamp(34px,6vw,84px)] leading-[.9] tracking-[-.01em] text-morado uppercase">
        {titulo}
      </p>
      <p className="mt-3.5 mb-0 text-[15px] leading-[1.55] text-parrafo">{children}</p>
    </div>
  )
}
