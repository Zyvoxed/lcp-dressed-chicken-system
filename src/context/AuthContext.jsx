import { createContext, useEffect, useMemo, useState } from 'react'
import { getCurrentUser, login as loginRequest } from '../services/authService.js'
import { loginRoute } from '../utils/constants.js'

/* eslint-disable react-refresh/only-export-components */
export const AuthContext = createContext(null)

const tokenStorageKey = 'authToken'
const userStorageKey = 'user'

function getStoredToken() {
  try {
    return localStorage.getItem(tokenStorageKey)
  } catch {
    return null
  }
}

function normalizeUser(user) {
  const role = user.role === 'Admin' ? 'admin' : user.role === 'Staff' ? 'employee' : null

  return {
    ...user,
    role,
  }
}

function clearStoredSession() {
  localStorage.removeItem(tokenStorageKey)
  localStorage.removeItem(userStorageKey)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(() => Boolean(getStoredToken()))

  useEffect(() => {
    const token = getStoredToken()

    if (!token) {
      try {
        localStorage.removeItem(userStorageKey)
      } catch {
        // Storage may be unavailable in restricted browser environments.
      }
      return undefined
    }

    let active = true

    async function restoreSession() {
      try {
        const restoredUser = normalizeUser(await getCurrentUser(token))

        if (active) {
          localStorage.setItem(userStorageKey, JSON.stringify(restoredUser))
          setUser(restoredUser)
        }
      } catch {
        if (active) {
          clearStoredSession()
          setUser(null)
        }
      } finally {
        if (active) {
          setAuthLoading(false)
        }
      }
    }

    restoreSession()

    return () => {
      active = false
    }
  }, [])

  async function login(username, password) {
    const result = await loginRequest(username, password)
    const authenticatedUser = normalizeUser(result.user)

    localStorage.setItem(tokenStorageKey, result.token)
    localStorage.setItem(userStorageKey, JSON.stringify(authenticatedUser))
    setUser(authenticatedUser)

    return authenticatedUser
  }

  function logout() {
    clearStoredSession()
    setUser(null)
    window.history.replaceState({}, '', loginRoute)
  }

  const value = useMemo(
    () => ({
      user,
      currentUser: user,
      login,
      logout,
      authLoading,
      role: user?.role || null,
      isAuthenticated: Boolean(user),
    }),
    [authLoading, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
