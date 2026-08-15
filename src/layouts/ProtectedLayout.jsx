import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import Login from '../pages/Login/Login.jsx'
import { defaultRoute, loginRoute, modules } from '../utils/constants.js'
import { hasRouteAccess } from '../utils/rolePermissions.js'
import MainLayout from './MainLayout.jsx'

function ProtectedLayout({ activeModule, onSelect, children }) {
  const { isAuthenticated, login, logout, role, user } = useAuth()

  console.log('Protected Route User:', user)

  useEffect(() => {
    if (!isAuthenticated && window.location.pathname !== loginRoute) {
      window.history.replaceState({}, '', loginRoute)
    }

    if (isAuthenticated && window.location.pathname === loginRoute) {
      window.history.replaceState({}, '', defaultRoute)
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !role) {
      return
    }

    const selectedModule = modules.find((module) => module.label === activeModule)

    if (selectedModule && !hasRouteAccess(selectedModule, role)) {
      onSelect(modules[0].label)
    }
  }, [activeModule, isAuthenticated, onSelect, role])

  if (!isAuthenticated) {
    return <Login onLogin={login} />
  }

  return (
    <MainLayout activeModule={activeModule} onSelect={onSelect} onLogout={logout} role={role} user={user}>
      {children}
    </MainLayout>
  )
}

export default ProtectedLayout
