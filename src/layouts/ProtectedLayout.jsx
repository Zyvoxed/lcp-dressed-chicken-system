import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import Login from '../pages/Login/Login.jsx'
import PageSkeleton from '../pages/Shared/PageSkeleton.jsx'
import PageTransition from '../pages/Shared/PageTransition.jsx'
import { defaultRoute, employeeRoute, loginRoute, modules } from '../utils/constants.js'
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
      const destination = role === 'employee'
        ? modules.find((module) => module.path === employeeRoute)
        : modules.find((module) => module.path === returnTo && hasRouteAccess(module, role))
          || modules.find((module) => module.path === defaultRoute)
      onSelect(destination.label)
    }
  }, [authLoading, isAuthenticated, onSelect, role])

  useEffect(() => {
    if (authLoading || !isAuthenticated || !role) {
      return
    }

    const selectedModule = modules.find((module) => module.label === activeModule)

    if (selectedModule && !hasRouteAccess(selectedModule, role)) {
      const destination = modules.find((module) => (
        module.path === (role === 'employee' ? employeeRoute : defaultRoute)
      ))
      onSelect(destination.label)
    }
  }, [activeModule, authLoading, isAuthenticated, onSelect, role])

  if (authLoading) {
    return <PageSkeleton variant="authentication" label="your account" />
  }

  if (!isAuthenticated) {
    return (
      <PageTransition>
        <Login onLogin={login} />
      </PageTransition>
    )
  }

  if (role === 'employee' && activeModule !== 'Record Sales') {
    return (
      <MainLayout
        activeModule="Record Sales"
        onSelect={onSelect}
        onLogout={logout}
        role={role}
        user={user}
      >
        {null}
      </MainLayout>
    )
  }

  return (
    <MainLayout activeModule={activeModule} onSelect={onSelect} onLogout={logout} role={role} user={user}>
      {children}
    </MainLayout>
  )
}

export default ProtectedLayout
