import { useState } from 'react'
import { Link } from 'react-router-dom'
import MobileNav from './MobileNav'

export default function Header() {
  const [navAbierto, setNavAbierto] = useState(false)

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-4">
      <Link to="/" className="font-semibold">
        Sorteos
      </Link>

      <button
        type="button"
        aria-label="Abrir menú"
        aria-expanded={navAbierto}
        onClick={() => setNavAbierto(true)}
      >
        {/* TODO: ícono burger del diseño */}
        Menú
      </button>

      <MobileNav abierto={navAbierto} onCerrar={() => setNavAbierto(false)} />
    </header>
  )
}
