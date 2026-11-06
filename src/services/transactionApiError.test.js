import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTransactionResponse, TransactionApiError } from './transactionApiError.js'

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      if (body === 'malformed') throw new SyntaxError('invalid JSON')
      return body
    },
  }
}

test('only an explicit confirmed rejection is classified as not committed', async () => {
  await assert.rejects(
    parseTransactionResponse(response(409, {
      success: false,
      code: 'TRANSACTION_REJECTED',
      transaction_outcome: 'not_committed',
      message: 'Rejected',
    }), 'Request failed'),
    (error) => error instanceof TransactionApiError
      && error.status === 409
      && error.outcome === 'not_committed'
      && error.code === 'TRANSACTION_REJECTED',
  )

  for (const body of [
    { success: false, code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', transaction_outcome: 'not_committed', message: 'Conflict' },
    { success: false, code: 'TRANSACTION_OUTCOME_UNKNOWN', transaction_outcome: 'unknown', message: 'Unknown' },
    { success: false, message: 'Legacy server error' },
  ]) {
    await assert.rejects(
      parseTransactionResponse(response(409, body), 'Request failed'),
      (error) => error instanceof TransactionApiError && error.outcome === 'unknown',
    )
  }
})

test('malformed responses and transport failures retain unknown outcome', async () => {
  await assert.rejects(
    parseTransactionResponse(response(500, 'malformed'), 'Request failed'),
    (error) => error instanceof TransactionApiError
      && error.status === 500
      && error.outcome === 'unknown'
      && error.cause instanceof SyntaxError,
  )

  const transportError = new TypeError('network unavailable')
  const error = new TransactionApiError('Cannot confirm', { originalError: transportError })
  assert.equal(error.outcome, 'unknown')
  assert.equal(error.originalError, transportError)
  assert.equal(error.cause, transportError)
})
