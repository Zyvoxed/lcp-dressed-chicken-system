import { authenticatedApiFetch } from './api.js'

export async function getDashboard(options = {}) {
  const response = await authenticatedApiFetch('/analytics/dashboard', options)
  let result
  try { result = await response.json() } catch { throw new Error('Unable to retrieve dashboard') }
  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.message || 'Unable to retrieve dashboard')
  }
  return result.data
}
