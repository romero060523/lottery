import { useEffect, useState, type RefCallback } from 'react'

// Valores del prototipo (docs/design/purple-draw-landing.html).
const OPCIONES_OBSERVER: IntersectionObserverInit = {
  threshold: 0.12,
  rootMargin: '0px 0px -8% 0px',
}
const FAILSAFE_MS = 1400

// Compartido entre todos los elementos: el failsafe solo actúa si el observer
// todavía no reveló ninguno, igual que en el prototipo.
let algunoReveladoPorObserver = false

/** Contextos donde el IntersectionObserver no llega a dispararse o no debe animar. */
function revelarSinEsperar() {
  return (
    document.visibilityState !== 'visible' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Marca un elemento como visible la primera vez que entra en viewport.
 * Con reduced motion o pestaña oculta arranca visible (sin transición), y si a
 * los 1400 ms el observer no reveló nada en la página, lo revela igual.
 */
export function useScrollReveal<T extends Element = HTMLDivElement>(): {
  ref: RefCallback<T>
  visible: boolean
} {
  // Callback ref en estado: el elemento puede montarse después que el hook.
  const [el, setEl] = useState<T | null>(null)
  const [visible, setVisible] = useState(revelarSinEsperar)

  useEffect(() => {
    if (!el || visible) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        algunoReveladoPorObserver = true
        setVisible(true)
      }
    }, OPCIONES_OBSERVER)
    observer.observe(el)

    const failsafe = setTimeout(() => {
      if (!algunoReveladoPorObserver) setVisible(true)
    }, FAILSAFE_MS)

    const alImprimir = () => setVisible(true)
    window.addEventListener('beforeprint', alImprimir)

    return () => {
      observer.disconnect()
      clearTimeout(failsafe)
      window.removeEventListener('beforeprint', alImprimir)
    }
  }, [el, visible])

  return { ref: setEl, visible }
}
