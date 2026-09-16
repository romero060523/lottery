import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import NarrowLayout from './components/layout/NarrowLayout'
import WideLayout from './components/layout/WideLayout'
import LandingPage from './pages/LandingPage'
import RegisterFormPage from './pages/RegisterFormPage'
import TicketLookupPage from './pages/TicketLookupPage'

// Sección 8.4: el panel admin se carga bajo demanda para que los visitantes
// públicos —que son la mayoría del tráfico— no descarguen su código.
const ProtectedRoute = lazy(() => import('./components/admin/ProtectedRoute'))
const AdminLoginPage = lazy(() => import('./pages/admin/AdminLoginPage'))
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'))
const AdminSorteosPage = lazy(() => import('./pages/admin/AdminSorteosPage'))
const AdminPremiosPage = lazy(() => import('./pages/admin/AdminPremiosPage'))
const AdminBoletosPage = lazy(() => import('./pages/admin/AdminBoletosPage'))
const AdminGanadoresPage = lazy(() => import('./pages/admin/AdminGanadoresPage'))

export default function App() {
  return (
    <Routes>
      <Route element={<WideLayout />}>
        <Route path="/" element={<LandingPage />} />
      </Route>

      <Route element={<NarrowLayout />}>
        <Route path="/registro" element={<RegisterFormPage />} />
        <Route path="/consulta" element={<TicketLookupPage />} />
      </Route>

      {/* TODO: fallback de carga del panel */}
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={null}>
            <Routes>
              <Route path="login" element={<AdminLoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route index element={<AdminDashboardPage />} />
                <Route path="sorteos" element={<AdminSorteosPage />} />
                <Route path="premios" element={<AdminPremiosPage />} />
                <Route path="boletos" element={<AdminBoletosPage />} />
                <Route path="ganadores" element={<AdminGanadoresPage />} />
              </Route>
            </Routes>
          </Suspense>
        }
      />
    </Routes>
  )
}
