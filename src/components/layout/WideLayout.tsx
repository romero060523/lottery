import { Outlet } from 'react-router-dom'
import CursorDot from './CursorDot'
import Footer from './Footer'
import Header from './Header'
import MobileStickyCta from './MobileStickyCta'

/** Layout ancho: landing a todo el ancho, con CTA sticky y cursor decorativo. */
export default function WideLayout() {
  return (
    <div className="min-h-screen">
      <CursorDot />
      <Header />
      <main>
        <Outlet />
      </main>
      <MobileStickyCta />
      <Footer />
    </div>
  )
}
