import { authenticatedApiFetch } from './api.js'

export async function recordPayment(data) {
  const response = await authenticatedApiFetch('/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  let result
  try { result = await response.json() } catch { throw new Error('Unable to record payment') }
  if (!response.ok || !result.success) throw new Error(result.message || 'Unable to record payment')
  if (!result.data?.payment_id) throw new Error('The Payments API returned an invalid response')
  return result.data
}
