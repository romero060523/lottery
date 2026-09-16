import { Outlet } from 'react-router-dom'
import Footer from './Footer'
import Header from './Header'

/** Layout angosto: formularios y consulta, contenido centrado. */
export default function NarrowLayout() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
