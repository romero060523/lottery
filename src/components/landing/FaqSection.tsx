import { useState } from 'react'
import Reveal from './Reveal'

/*
 * Estático, como dice la sección 7 de docs/arquitectura.md. Las respuestas del
 * prototipo prometían correo y confirmación inmediata; aquí la revisión del pago
 * es manual, no se guarda correo y cada compra genera un solo pase con su código
 * y su cantidad. Sin cifras ni precios: cambian por edición y ya se muestran en
 * las secciones que los leen de la base.
 */
const PREGUNTAS = [
  {
    pregunta: '¿Cómo recibo mi ticket?',
    respuesta:
      'Al reservar, la pantalla te muestra tu pase digital con su código. Una persona revisa tu pago antes de confirmarlo: no es automático y no enviamos nada por correo, así que guarda el código o una captura de esa pantalla.',
  },
  {
    pregunta: '¿Cuándo se realiza el sorteo?',
    respuesta:
      'Cada edición publica su fecha de sorteo y su cierre de ventas. Los verás arriba, en la franja de fechas, junto con la cuenta regresiva.',
  },
  {
    pregunta: '¿Dónde veo a los ganadores?',
    respuesta:
      'Publicamos a los ganadores de cada edición en esta misma página, en cuanto el sorteo se realiza.',
  },
  {
    pregunta: '¿Puedo comprar más de un ticket?',
    respuesta:
      'Sí. Puedes llevar varios en la misma compra y, por cada 4 comprados, uno más va gratis. Hay un tope por compra y por lo que quede disponible en la edición; queda un solo pase con tu código y la cantidad total.',
  },
] as const

/** Acordeón de preguntas frecuentes: una abierta a la vez, todas cerradas al cargar. */
export default function FaqSection() {
  const [abierta, setAbierta] = useState<number | null>(null)

  return (
    <section
      id="faq"
      data-cursor-color="var(--color-morado)"
      className="border-t border-tinta/35 px-lateral py-seccion"
    >
      <Reveal
        as="h2"
        variante="texto"
        desplazamiento={40}
        duracion={[0.9, 1]}
        className="m-0 mb-[clamp(30px,5vh,56px)] font-display text-[clamp(34px,6vw,84px)] leading-[.9] tracking-[-.02em] uppercase"
      >
        Preguntas frecuentes
      </Reveal>

      <div className="max-w-[880px] border-t border-tinta">
        {PREGUNTAS.map(({ pregunta, respuesta }, indice) => {
          const desplegada = abierta === indice
          const idBoton = `faq-${indice}`
          const idPanel = `faq-${indice}-respuesta`

          return (
            <div key={pregunta} className="border-b border-tinta">
              {/* El botón va dentro de un encabezado para que el acordeón tenga
                  jerarquía y no sea una lista de botones sueltos. */}
              <h3 className="m-0">
                <button
                  type="button"
                  id={idBoton}
                  aria-expanded={desplegada}
                  aria-controls={idPanel}
                  onClick={() => setAbierta(desplegada ? null : indice)}
                  className="flex w-full cursor-pointer items-center justify-between gap-5 bg-transparent px-0.5 py-6 text-left font-display text-[clamp(20px,3vw,34px)] leading-[1.05] text-tinta uppercase hover:text-morado"
                >
                  {pregunta}
                  {/* El estado lo comunica aria-expanded; el signo es decorativo. */}
                  <span aria-hidden="true" className="font-sans text-[24px] leading-none text-morado">
                    {desplegada ? '−' : '+'}
                  </span>
                </button>
              </h3>

              {desplegada && (
                <div id={idPanel} role="region" aria-labelledby={idBoton}>
                  <p className="m-0 max-w-[620px] px-0.5 pb-[26px] text-[15px] leading-[1.6] text-parrafo">
                    {respuesta}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
