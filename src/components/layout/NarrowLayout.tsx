import { Outlet } from 'react-router-dom'
import Footer from './Footer'
import Header from './Header'

/** Layout angosto: formularios y consulta, contenido centrado. */
export default function NarrowLayout() {
  return (
    <div className="min-h-screen">
      <Header />
      {/* El header es fixed: pt-24 (96px) es lo mínimo que el hero del prototipo deja libre debajo */}
      <main className="mx-auto w-full max-w-xl px-4 pt-24 pb-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
