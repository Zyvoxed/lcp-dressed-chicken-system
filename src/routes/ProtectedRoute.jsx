import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth.js'
import PageSkeleton from '../pages/Shared/PageSkeleton.jsx'
import { loginRoute } from '../utils/constants.js'

function ProtectedRoute({ children }) {
  const { authLoading, user } = useAuth()

  useEffect(() => {
    if (!authLoading && !user) {
      window.history.replaceState({}, '', loginRoute)
    }
  }, [authLoading, user])

  if (authLoading) {
    return <PageSkeleton variant="authentication" label="your account" />
  }

  if (!user) {
    return null
  }

  return children
}

export default ProtectedRoute
