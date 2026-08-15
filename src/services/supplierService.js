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

export async function getSuppliers(options = {}) {
  const response = await apiFetch('/suppliers', options)
  const result = await parseResponse(response, 'Unable to retrieve suppliers')

  if (!Array.isArray(result.data)) {
    throw new Error('The suppliers API returned an invalid response')
  }

  return result.data
}

export async function createSupplier(data) {
  const response = await apiFetch('/suppliers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  const result = await parseResponse(response, 'Unable to create supplier')

  if (!result.data || !result.data.supplier_id) {
    throw new Error('The suppliers API returned an invalid response')
  }

  return result.data
}
