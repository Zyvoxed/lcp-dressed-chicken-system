import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import { loginRoute } from '../utils/constants.js'

function ProtectedRoute({ children }) {
  const { user } = useAuth()

  console.log('Protected Route User:', user)

  useEffect(() => {
    if (!user) {
      window.history.replaceState({}, '', loginRoute)
    }
  }, [user])

  if (!user) {
    return null
  }

  return children
}

export default ProtectedRoute
