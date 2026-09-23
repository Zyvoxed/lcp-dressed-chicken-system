const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

const defaultApiBaseUrl = import.meta.env.PROD ? '/api' : 'http://localhost:5000/api'

export const API_BASE_URL = (configuredApiBaseUrl || defaultApiBaseUrl).replace(/\/$/, '')

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
