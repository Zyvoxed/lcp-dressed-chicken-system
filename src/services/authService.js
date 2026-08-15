import { apiFetch } from './api.js'

async function parseResponse(response, fallbackMessage) {
  let result

  try {
    result = await response.json()
  } catch {
    throw new Error(fallbackMessage)
  }

  if (!response.ok || !result.success) {
    throw new Error(result.message || fallbackMessage)
  }

  return result
}

export async function login(username, password) {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
  const result = await parseResponse(response, 'Unable to log in')

  if (!result.token || !result.user) {
    throw new Error('The authentication API returned an invalid response')
  }

  return {
    token: result.token,
    user: result.user,
  }
}

export async function getCurrentUser(token) {
  const response = await apiFetch('/auth/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })
  const result = await parseResponse(response, 'Unable to restore your session')

  if (!result.user) {
    throw new Error('The authentication API returned an invalid response')
  }

  return result.user
}
