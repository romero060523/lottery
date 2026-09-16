import { Outlet } from 'react-router-dom'
import CursorDot from './CursorDot'
import Footer from './Footer'
import Header from './Header'
import MobileStickyCta from './MobileStickyCta'

/** Layout ancho: landing a todo el ancho, con CTA sticky y cursor decorativo. */
export default function WideLayout() {
  return (
    <div className="min-h-screen">
      <div
        aria-hidden="true"
        className="grano pointer-events-none fixed inset-0 z-9000 opacity-50 mix-blend-multiply"
      />
      <CursorDot />
      <Header />
      <main data-cursor-color="var(--color-morado)" className="relative z-10">
        <Outlet />
      </main>
      <MobileStickyCta />
      <Footer />
    </div>
  )
}
