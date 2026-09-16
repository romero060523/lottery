import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

/**
 * Gatea la navegación a /admin/*: redirige a /admin/login si no hay sesión.
 * No verifica la tabla `admins` — de eso ya se encarga RLS en el servidor.
 */
export default function ProtectedRoute() {
  const [haySesion, setHaySesion] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHaySesion(data.session !== null))

    const { data } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      setHaySesion(sesion !== null)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  // TODO: indicador de carga mientras se resuelve la sesión
  if (haySesion === null) return null
  if (!haySesion) return <Navigate to="/admin/login" replace />

  return <Outlet />
}
