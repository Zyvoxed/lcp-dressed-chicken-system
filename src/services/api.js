export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '')

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
