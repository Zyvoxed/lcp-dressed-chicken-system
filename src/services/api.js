const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

if (import.meta.env.PROD && !configuredApiBaseUrl) {
  throw new Error('Missing required production environment variable: VITE_API_BASE_URL')
}

export const API_BASE_URL = (configuredApiBaseUrl || 'http://localhost:5000/api').replace(/\/$/, '')

export function apiFetch(path, options) {
  return fetch(`${API_BASE_URL}${path}`, options)
}

export function authenticatedApiFetch(path, options = {}) {
  const headers = new Headers(options.headers)
  const token = localStorage.getItem('authToken')

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return apiFetch(path, {
    ...options,
    headers,
  })
}
