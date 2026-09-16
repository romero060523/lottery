import type { CSSProperties, ReactNode } from 'react'
import { useScrollReveal } from '../../hooks/useScrollReveal'

type RevealComun = {
  as?: 'div' | 'span' | 'p' | 'h2' | 'li'
  /** Segundos: [opacidad, transform]. El prototipo da a cada propiedad su duración. */
  duracion: readonly [number, number]
  /** Segundos. */
  retraso?: number
  className?: string
  children?: ReactNode
}

type RevealProps = RevealComun &
  (
    | {
        /** Sube desde `desplazamiento` px. */
        variante: 'texto'
        desplazamiento: number
      }
    | {
        /** Crece desde scale(.2) rotate(35deg) hasta `rotacion` grados. */
        variante: 'foto'
        rotacion: number
        /** scale(1.04) y un 30 % de la rotación al pasar el mouse (cards de premio). */
        escalaAlHover?: boolean
      }
  )

/** Aparición al hacer scroll. Los estilos viven en `.reveal` (index.css). */
export default function Reveal(props: RevealProps) {
  const { as: Tag = 'div', duracion, retraso = 0, className, children } = props
  const { ref, visible } = useScrollReveal<HTMLElement>()

  const variables: Record<`--reveal-${string}`, string> = {
    '--reveal-duracion-opacidad': `${duracion[0]}s`,
    '--reveal-duracion-transform': `${duracion[1]}s`,
    '--reveal-retraso': `${retraso}s`,
    ...(props.variante === 'texto'
      ? { '--reveal-desplazamiento': `${props.desplazamiento}px` }
      : { '--reveal-rotacion': `${props.rotacion}deg` }),
  }

  return (
    <Tag
      ref={ref}
      style={variables as CSSProperties}
      className={`reveal reveal-${props.variante} ${className ?? ''}`}
      data-shown={visible ? '' : undefined}
      data-escala-hover={props.variante === 'foto' && props.escalaAlHover ? '' : undefined}
    >
      {children}
    </Tag>
  )
}
