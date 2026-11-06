import { authenticatedApiFetch } from './api.js'
import { TransactionApiError, parseTransactionResponse } from './transactionApiError.js'

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

export async function createSale(data, idempotencyKey) {
  let response
  try {
    response = await authenticatedApiFetch('/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    })
  } catch (error) {
    throw new TransactionApiError('Unable to confirm sale status. Check transaction status before retrying.', {
      originalError: error,
    })
  }
  const result = await parseTransactionResponse(response, 'Unable to record sale')

  if (!result.data?.sale_id) {
    throw new TransactionApiError('The sale result could not be read. Check the sales records before trying again.', {
      status: response.status,
    })
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
