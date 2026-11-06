import { authenticatedApiFetch } from './api.js'
import { TransactionApiError, parseTransactionResponse } from './transactionApiError.js'

export async function recordPayment(data, idempotencyKey) {
  let response
  try {
    response = await authenticatedApiFetch('/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    })
  } catch (error) {
    throw new TransactionApiError('Unable to confirm payment status. Check transaction status before retrying.', {
      originalError: error,
    })
  }
  const result = await parseTransactionResponse(response, 'Unable to record payment')
  if (!result.data?.payment_id) {
    throw new TransactionApiError('The payment result could not be read. Check the payment history before trying again.', {
      status: response.status,
    })
  }
  return result.data
}
