import { authenticatedApiFetch } from './api.js'

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

export async function createSale(data) {
  const response = await authenticatedApiFetch('/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result = await parseResponse(response, 'Unable to record sale')

  if (!result.data?.sale_id) {
    throw new Error('The Sales API returned an invalid response')
  }
  return result.data
}

export async function getSales(options = {}) {
  const response = await authenticatedApiFetch('/sales', options)
  const result = await parseResponse(response, 'Unable to retrieve sales')

  if (!Array.isArray(result.data)) {
    throw new Error('The Sales API returned an invalid response')
  }
  return result.data
}
