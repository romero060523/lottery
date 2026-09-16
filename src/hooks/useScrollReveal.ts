import { useEffect, useRef, useState } from 'react'

/** Marca un elemento como visible la primera vez que entra en viewport. */
export function useScrollReveal<T extends Element = HTMLDivElement>(
  rootMargin = '0px 0px -15% 0px',
) {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin, visible])

  return { ref, visible }
}
