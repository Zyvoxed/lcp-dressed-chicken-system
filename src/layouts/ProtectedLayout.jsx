import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import Login from '../pages/Login/Login.jsx'
import LoadingSpinner from '../pages/Shared/LoadingSpinner.jsx'
import { defaultRoute, loginRoute, modules } from '../utils/constants.js'
import { hasRouteAccess } from '../utils/rolePermissions.js'
import MainLayout from './MainLayout.jsx'

function ProtectedLayout({ activeModule, onSelect, children }) {
  const { authLoading, isAuthenticated, login, logout, role, user } = useAuth()

  useEffect(() => {
    if (!authLoading && !isAuthenticated && window.location.pathname !== loginRoute) {
      sessionStorage.setItem('returnTo', window.location.pathname)
      window.history.replaceState({}, '', loginRoute)
    }

    if (isAuthenticated && window.location.pathname === loginRoute) {
      const returnTo = sessionStorage.getItem('returnTo') || defaultRoute
      sessionStorage.removeItem('returnTo')
      const destination = modules.find((module) => module.path === returnTo) || modules[0]
      onSelect(destination.label)
    }
  }, [authLoading, isAuthenticated, onSelect])

  useEffect(() => {
    if (authLoading || !isAuthenticated || !role) {
      return
    }

    const selectedModule = modules.find((module) => module.label === activeModule)

    if (selectedModule && !hasRouteAccess(selectedModule, role)) {
      onSelect(modules[0].label)
    }
  }, [activeModule, authLoading, isAuthenticated, onSelect, role])

  if (authLoading) {
    return <LoadingSpinner />
  }

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
