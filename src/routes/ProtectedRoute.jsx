import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import LoadingSpinner from '../pages/Shared/LoadingSpinner.jsx'
import { loginRoute } from '../utils/constants.js'

function ProtectedRoute({ children }) {
  const { authLoading, user } = useAuth()

  useEffect(() => {
    if (!authLoading && !user) {
      window.history.replaceState({}, '', loginRoute)
    }
  }, [authLoading, user])

  if (authLoading) {
    return <LoadingSpinner />
  }

  if (!user) {
    return null
  }

  return children
}

export default ProtectedRoute
