import { authenticatedApiFetch } from './api.js'

export async function getIdempotencyStatus(operation, key, options = {}) {
  const response = await authenticatedApiFetch(
    `/idempotency/${encodeURIComponent(operation)}/${encodeURIComponent(key)}`,
    options,
  )
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('Unable to check the saved transaction status')
  }
  if (!response.ok || !result.success || !result.data?.state) {
    throw new Error(result.message || 'Unable to check the saved transaction status')
  }
  return result.data
}
