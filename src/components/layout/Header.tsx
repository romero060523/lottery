import { useState } from 'react'
import { Link } from 'react-router-dom'
import MobileNav from './MobileNav'

/** Flota sobre el contenido, como en el prototipo: cada layout deja libre su alto. */
export default function Header() {
  const [navAbierto, setNavAbierto] = useState(false)

  return (
    <header className="fixed inset-x-0 top-0 z-8000 flex items-center justify-between px-lateral py-4">
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
