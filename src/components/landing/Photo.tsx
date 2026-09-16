import { useState } from 'react'

type PhotoProps = {
  src: string | null
  alt: string
  /** Texto del placeholder del prototipo. */
  placeholder: string
  /** Tamaño y interlineado del texto del placeholder. */
  className?: string
  /** Foto above the fold: se descarga sin lazy loading. */
  prioritaria?: boolean
}

/**
 * La imagen a sangre dentro del marco, o el placeholder del prototipo cuando
 * `src` es null o la imagen no carga. El marco (borde, sombra) lo pone el padre.
 */
export default function Photo({ src, alt, placeholder, className, prioritaria = false }: PhotoProps) {
  const [srcFallido, setSrcFallido] = useState<string | null>(null)

  if (src && src !== srcFallido) {
    return (
      <img
        src={src}
        alt={alt}
        loading={prioritaria ? 'eager' : 'lazy'}
        fetchPriority={prioritaria ? 'high' : 'auto'}
        decoding="async"
        onError={() => setSrcFallido(src)}
        className="absolute inset-0 size-full object-cover"
      />
    )
  }

  return (
    <span className={`font-semibold tracking-[.14em] text-placeholder-texto uppercase ${className ?? ''}`}>
      {placeholder}
    </span>
  )
}
