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

export async function getStockInRecords(options = {}) {
  const response = await authenticatedApiFetch('/stock-in', options)
  const result = await parseResponse(response, 'Unable to retrieve stock-in records')

  if (!Array.isArray(result.data)) {
    throw new Error('Stock delivery records could not be loaded. Please try again.')
  }

  return result.data
}

export async function getStockInBatchAllocations(stockInId, options = {}) {
  const response = await authenticatedApiFetch(`/stock-in/${stockInId}/allocations`, options)
  const result = await parseResponse(response, 'Unable to retrieve FIFO batch allocations')

  if (!result.data?.batch || !Array.isArray(result.data.allocations)) {
    throw new Error('The FIFO batch details could not be loaded. Please try again.')
  }

  return result.data
}

export async function createStockIn(data, idempotencyKey) {
  let response
  try {
    response = await authenticatedApiFetch('/stock-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(data),
    })
  } catch (error) {
    throw new TransactionApiError('Unable to confirm stock delivery status. Check transaction status before retrying.', {
      originalError: error,
    })
  }
  const result = await parseTransactionResponse(response, 'Unable to record stock-in')

  if (!result.data?.stockin_id) {
    throw new TransactionApiError('The stock delivery result could not be read. Check the delivery history before trying again.', {
      status: response.status,
    })
  }

  return result.data
}
