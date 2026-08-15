import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import LoadingSpinner from '../pages/Shared/LoadingSpinner.jsx'
import { defaultRoute, loginRoute } from '../utils/constants.js'

function RoleGuard({ children, roles = [], allowedRoles }) {
  const { authLoading, user } = useAuth()
  const requiredRoles = (allowedRoles || roles).map((role) => (
    role === 'Admin' ? 'admin' : role === 'Staff' ? 'employee' : role
  ))
  const hasAccess = user && (requiredRoles.length === 0 || requiredRoles.includes(user.role))

  useEffect(() => {
    if (authLoading) {
      return
    }

    if (!user) {
      window.history.replaceState({}, '', loginRoute)
      return
    }

    if (!hasAccess) {
      window.history.replaceState({}, '', defaultRoute)
    }
  }, [authLoading, hasAccess, user])

  if (authLoading) {
    return <LoadingSpinner />
  }

  if (!hasAccess) {
    return null
  }

  return children
}

export default RoleGuard
