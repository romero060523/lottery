import { useCallback, type RefCallback } from 'react'

type Capa = { el: HTMLElement; factor: number }

// Un solo listener de scroll/resize y un rAF por frame para todas las capas.
const capas = new Set<Capa>()
let frameId: number | null = null

function actualizar() {
  frameId = null
  const vh = window.innerHeight

  for (const { el, factor } of capas) {
    // El rect incluye el transform ya aplicado, como en el prototipo: el
    // desplazamiento converge a factor / (1 - factor) de la distancia al
    // centro. Se mantiene así para que la intensidad sea la aprobada.
    const r = el.getBoundingClientRect()
    if (r.bottom < -200 || r.top > vh + 200) continue

    const desplazamiento = (r.top + r.height / 2 - vh / 2) * factor
    el.style.transform = `translate3d(0,${desplazamiento.toFixed(1)}px,0)`
  }
}

function programar() {
  if (frameId === null) frameId = requestAnimationFrame(actualizar)
}

/**
 * Desplaza el elemento en vertical según su distancia al centro del viewport.
 * Factor negativo = sube más rápido que el scroll. Desactivado con reduced motion.
 */
export function useParallax<T extends HTMLElement = HTMLDivElement>(factor: number): RefCallback<T> {
  return useCallback(
    (el: T | null) => {
      if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      const capa = { el, factor }
      capas.add(capa)
      if (capas.size === 1) {
        window.addEventListener('scroll', programar, { passive: true })
        window.addEventListener('resize', programar)
      }
      programar()

      return () => {
        capas.delete(capa)
        el.style.transform = ''
        if (capas.size > 0) return

        window.removeEventListener('scroll', programar)
        window.removeEventListener('resize', programar)
        if (frameId !== null) {
          cancelAnimationFrame(frameId)
          frameId = null
        }
      }
    },
    [factor],
  )
}
