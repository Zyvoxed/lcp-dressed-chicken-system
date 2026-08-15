import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { defaultRoute, loginRoute } from '../utils/constants.js'

function RoleGuard({ children, roles = [], allowedRoles }) {
  const { user } = useAuth()
  const requiredRoles = allowedRoles || roles
  const hasAccess = user && (requiredRoles.length === 0 || requiredRoles.includes(user.role))

  useEffect(() => {
    if (!user) {
      window.history.replaceState({}, '', loginRoute)
      return
    }

    if (!hasAccess) {
      window.history.replaceState({}, '', defaultRoute)
    }
  }, [hasAccess, user])

  if (!hasAccess) {
    return null
  }

  return children
}

export default RoleGuard
