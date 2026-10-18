import { apiFetch } from './api.js'

async function parseResponse(response, fallbackMessage) {
  let result

  try {
    result = await response.json()
  } catch {
    throw new Error(fallbackMessage)
  }

  if (!response.ok || !result.success) {
    const error = new Error(result.message || fallbackMessage)
    error.status = response.status
    throw error
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

export async function verifyRecoveryEmail(token) {
  const response = await apiFetch('/auth/verify-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })
  return parseResponse(response, 'Unable to verify recovery email')
}

export async function requestPasswordReset(email) {
  const response = await apiFetch('/auth/forgot-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })
  return parseResponse(response, 'Unable to process the request')
}

export async function resetPassword(token, password) {
  const response = await apiFetch('/auth/reset-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token, password }),
  })
  return parseResponse(response, 'Unable to reset password')
}
