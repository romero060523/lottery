import { Link } from 'react-router-dom'

/** CTA fijo inferior, solo en mobile. */
export default function MobileStickyCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 p-4 md:hidden">
      <Link to="/registro">Comprar tickets</Link>
    </div>
  )
}
