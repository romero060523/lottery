import { useCallback, useRef, type RefCallback } from 'react'

type Capa = {
  seccion: HTMLElement | null
  circulo: HTMLElement | null
  desde: number
  /** Sin movimiento: el círculo queda fijo, pero la geometría se sigue recalculando. */
  estatica: boolean
  /** Último diámetro y última escala aplicados, para no reescribir estilos sin cambio. */
  diametro: number
  escala: number
  /** La sección crece cuando llegan los datos: hay que volver a medirla. */
  observador: ResizeObserver | null
}

// Cuánto sube el centro del círculo sobre el borde inferior de la sección, en
// proporción a su alto: lo justo para que asome como un domo y no como media luna.
const ANCLA = 0.1
// Con reduced motion no hay recorrido: una sola escala, la del tramo medio.
const ESCALA_ESTATICA = 0.55

// Un solo listener de scroll/resize y un rAF por frame para todas las capas,
// como en useParallax. La escala se escribe directo en el estilo del elemento:
// a 60 fps un estado de React sería un re-render por frame.
const capas = new Set<Capa>()
let frameId: number | null = null

/**
 * Tamaño y anclaje del círculo a partir de la caja de la sección, no del
 * viewport: con `scale(1)` el radio alcanza las esquinas superiores, así que
 * cubre la sección entera tanto en un teléfono alto como en un monitor ancho.
 * Solo se reescribe cuando la sección cambia de tamaño; por frame se toca
 * únicamente el transform, que no provoca layout.
 */
function aplicarGeometria(capa: Capa, circulo: HTMLElement, r: DOMRect) {
  const margen = r.height * ANCLA
  // El 1.5 % extra evita que en scale(1) quede una línea de fondo sin tapar en
  // las esquinas de arriba, donde el radio da justo.
  const diametro = 2 * Math.hypot(r.width / 2, r.height - margen) * 1.015
  if (Math.abs(diametro - capa.diametro) < 1) return

  capa.diametro = diametro
  circulo.style.width = `${diametro.toFixed(1)}px`
  circulo.style.height = `${diametro.toFixed(1)}px`
  circulo.style.bottom = `${(margen - diametro / 2).toFixed(1)}px`
  // Centrado con `left: 50%` y medio diámetro de margen negativo. Con `mx-auto`
  // no vale: al ser el círculo más ancho que la sección, los márgenes automáticos
  // tendrían que ser negativos y CSS resuelve ese caso poniendo margin-left en 0,
  // lo que empuja el círculo a la derecha.
  circulo.style.marginLeft = `${(-diametro / 2).toFixed(1)}px`
}

function actualizar() {
  frameId = null
  const vh = window.innerHeight

  for (const capa of capas) {
    const { seccion, circulo } = capa
    if (!seccion || !circulo) continue

    const r = seccion.getBoundingClientRect()
    if (r.bottom < -200 || r.top > vh + 200) continue

    aplicarGeometria(capa, circulo, r)

    // El recorrido es siempre una altura de viewport: 0 cuando el borde
    // superior de la sección entra por abajo y 1 cuando llega arriba del todo,
    // es decir, cuando la sección pasa a ocupar la pantalla. Si dependiera del
    // alto de la sección, una sección alta —la de móvil— se quedaría a medio
    // crecer justo cuando ya se está leyendo.
    const progreso = Math.min(1, Math.max(0, (vh - r.top) / vh))
    const escala = capa.estatica ? ESCALA_ESTATICA : capa.desde + progreso * (1 - capa.desde)
    if (Math.abs(escala - capa.escala) < 0.001) continue

    capa.escala = escala
    circulo.style.transform = `scale(${escala.toFixed(3)})`
  }
}

function programar() {
  if (frameId === null) frameId = requestAnimationFrame(actualizar)
}

function suscribir(capa: Capa) {
  if (capas.has(capa)) return
  capas.add(capa)

  if (capas.size === 1) {
    window.addEventListener('scroll', programar, { passive: true })
    window.addEventListener('resize', programar)
  }
  programar()
}

function desuscribir(capa: Capa) {
  if (!capas.delete(capa) || capas.size > 0) return

  window.removeEventListener('scroll', programar)
  window.removeEventListener('resize', programar)
  if (frameId !== null) {
    cancelAnimationFrame(frameId)
    frameId = null
  }
}

/** Con los dos elementos montados: geometría, escala inicial y alta en el bucle. */
function montar(capa: Capa) {
  const { seccion, circulo } = capa
  if (!seccion || !circulo) return

  capa.estatica = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  aplicarGeometria(capa, circulo, seccion.getBoundingClientRect())

  // Sin esto el círculo aparecería a tamaño natural hasta el primer frame.
  capa.escala = capa.estatica ? ESCALA_ESTATICA : capa.desde
  circulo.style.transform = `scale(${capa.escala})`
  suscribir(capa)

  // La sección se monta antes que sus datos: cuando llegan los pases de ejemplo
  // crece, y sin esto el círculo se quedaría con el diámetro de la sección vacía
  // hasta el siguiente scroll.
  capa.observador?.disconnect()
  capa.observador = new ResizeObserver(programar)
  capa.observador.observe(seccion)
}

/**
 * Escala un círculo de fondo según lo recorrido de su sección. Va ligado a la
 * posición del scroll, no a una duración: si el usuario se detiene, la escala se
 * queda en la que corresponde a esa posición. `scale(1)` es cobertura completa
 * de la sección. Con reduced motion el círculo queda quieto en una escala fija.
 *
 * Las dos refs describen la misma capa; React monta primero la del círculo
 * (hijo) y después la de la sección, así que monta la que complete el par.
 */
export function useCirculoScroll({ desde = 0.14 }: { desde?: number } = {}) {
  const capa = useRef<Capa>({
    seccion: null,
    circulo: null,
    desde,
    estatica: false,
    diametro: 0,
    escala: 0,
    observador: null,
  })

  const refSeccion = useCallback<RefCallback<HTMLElement>>(
    (el) => {
      const actual = capa.current
      actual.desde = desde
      actual.seccion = el
      if (el) montar(actual)

      return () => {
        actual.seccion = null
        actual.observador?.disconnect()
        actual.observador = null
        desuscribir(actual)
      }
    },
    [desde],
  )

  const refCirculo = useCallback<RefCallback<HTMLElement>>(
    (el) => {
      const actual = capa.current
      actual.desde = desde
      actual.circulo = el
      if (!el) return

      montar(actual)

      return () => {
        actual.circulo = null
        actual.diametro = 0
        actual.escala = 0
        el.removeAttribute('style')
        desuscribir(actual)
      }
    },
    [desde],
  )

  return { refSeccion, refCirculo }
}
