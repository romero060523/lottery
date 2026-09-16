type MobileNavProps = {
  abierto: boolean
  onCerrar: () => void
}

/** Menú fullscreen: Premios / Cómo participar / Tickets / Ganadores. */
export default function MobileNav({ abierto, onCerrar }: MobileNavProps) {
  if (!abierto) return null

  return (
    <nav className="fixed inset-0 z-50">
      <button type="button" aria-label="Cerrar menú" onClick={onCerrar}>
        Cerrar
      </button>
      {/* TODO: enlaces a las secciones de la landing */}
    </nav>
  )
}
