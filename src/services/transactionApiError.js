export class TransactionApiError extends Error {
  constructor(message, { status = null, code = 'TRANSACTION_OUTCOME_UNKNOWN', outcome = 'unknown', originalError = null } = {}) {
    super(message, originalError ? { cause: originalError } : undefined)
    this.name = 'TransactionApiError'
    this.status = status
    this.code = code
    this.outcome = outcome === 'not_committed' ? outcome : 'unknown'
    this.originalError = originalError
  }
}

export async function parseTransactionResponse(response, fallbackMessage) {
  let result
  try {
    result = await response.json()
  } catch (error) {
    throw new TransactionApiError(fallbackMessage, {
      status: response.status,
      originalError: error,
    })
  }

  if (!result || typeof result !== 'object' || !response.ok || !result.success) {
    const code = result?.code || 'TRANSACTION_OUTCOME_UNKNOWN'
    const outcome = response.status >= 400 && response.status < 500
      && code === 'TRANSACTION_REJECTED'
      && result?.transaction_outcome === 'not_committed'
      ? 'not_committed'
      : 'unknown'
    throw new TransactionApiError(result?.message || fallbackMessage, {
      status: response.status,
      code,
      outcome,
    })
  }
  return result
}
