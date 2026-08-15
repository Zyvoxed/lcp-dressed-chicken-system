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

export async function getStockInRecords(options = {}) {
  const response = await authenticatedApiFetch('/stock-in', options)
  const result = await parseResponse(response, 'Unable to retrieve stock-in records')

  if (!Array.isArray(result.data)) {
    throw new Error('The Stock-In API returned an invalid response')
  }

  return result.data
}

export async function createStockIn(data) {
  const response = await authenticatedApiFetch('/stock-in', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  const result = await parseResponse(response, 'Unable to record stock-in')

  if (!result.data?.stockin_id) {
    throw new Error('The Stock-In API returned an invalid response')
  }

  return result.data
}
