import { useEffect, useRef } from 'react'

/**
 * Punto que sigue el cursor y toma el `data-cursor-color` de la sección que
 * ocupa más del 35 % de su alto en pantalla. Solo en dispositivos con hover.
 */
export default function CursorDot() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const punto = ref.current
    if (!punto || !window.matchMedia('(hover: hover)').matches) return

    // Directo al DOM: un setState por mousemove re-renderizaría a cada pixel.
    const mover = (ev: MouseEvent) => {
      punto.style.transform = `translate(${ev.clientX - 5}px,${ev.clientY - 5}px)`
    }
    window.addEventListener('mousemove', mover)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const color = (entry.target as HTMLElement).dataset.cursorColor
          if (entry.isIntersecting && entry.intersectionRatio > 0.35 && color) {
            punto.style.backgroundColor = color
          }
        }
      },
      { threshold: [0.36] },
    )
    document.querySelectorAll('[data-cursor-color]').forEach((el) => observer.observe(el))

    return () => {
      window.removeEventListener('mousemove', mover)
      observer.disconnect()
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ transform: 'translate(-100px,-100px)' }}
      className="pointer-events-none fixed top-0 left-0 z-9500 hidden size-2.5 rounded-full bg-morado [transition:background-color_.4s_ease,width_.25s_ease,height_.25s_ease] [@media(hover:hover)]:block"
    />
  )
}
