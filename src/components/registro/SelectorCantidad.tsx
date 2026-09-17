import type { ReactNode } from 'react'

type SelectorCantidadProps = {
  cantidad: number
  maximo: number
  enVuelo: boolean
  onCambiar: (cantidad: number) => void
  /** El `<input>` registrado en react-hook-form; los botones escriben el mismo campo. */
  children: ReactNode
  error?: string
  ayuda: string
}

const CLASES_BOTON =
  'size-14 flex-none border border-tinta text-[24px] leading-none enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-35'

/** Stepper para cualquier cantidad distinta de los paquetes. */
export default function SelectorCantidad({ cantidad, maximo, enVuelo, onCambiar, children, error, ayuda }: SelectorCantidadProps) {
  const valida = Number.isInteger(cantidad)

  return (
    <div>
      <label htmlFor="cantidad" className="mb-2.5 block text-[10px] leading-none font-semibold tracking-[.2em] text-parrafo uppercase">
        Otra cantidad
      </label>

      <div className="flex items-stretch">
        <button
          type="button"
          aria-label="Quitar un ticket"
          disabled={enVuelo || !valida || cantidad <= 1}
          onClick={() => onCambiar(cantidad - 1)}
          className={`${CLASES_BOTON} rounded-l-[6px] bg-hueso text-tinta enabled:hover:bg-tinta enabled:hover:text-hueso`}
        >
          −
        </button>
        {children}
        <button
          type="button"
          aria-label="Agregar un ticket"
          disabled={enVuelo || !valida || cantidad >= maximo}
          onClick={() => onCambiar(cantidad + 1)}
          className={`${CLASES_BOTON} rounded-r-[6px] bg-tinta text-hueso enabled:hover:bg-morado`}
        >
          +
        </button>
      </div>

      {error ? (
        <p id="cantidad-nota" role="alert" className="mt-2 mb-0 text-[12px] leading-[1.5] font-medium text-coral">
          {error}
        </p>
      ) : (
        <p id="cantidad-nota" className="mt-2 mb-0 text-[11px] leading-[1.6] text-parrafo">
          {ayuda}
        </p>
      )}
    </div>
  )
}
