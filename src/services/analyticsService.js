import { authenticatedApiFetch } from './api.js'

export async function getBusinessAnalytics(options = {}) {
  const response = await authenticatedApiFetch('/analytics/dashboard/business', options)
  let result
  try { result = await response.json() } catch { throw new Error('Unable to retrieve business analytics') }
  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.message || 'Unable to retrieve business analytics')
  }
  return result.data
}
