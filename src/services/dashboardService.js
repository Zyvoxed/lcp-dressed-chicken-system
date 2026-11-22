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

export async function getStaffSalesActivity(options = {}) {
  const response = await authenticatedApiFetch('/analytics/dashboard/sales-activity', options)
  let result
  try { result = await response.json() } catch { throw new Error('Unable to retrieve sales activity') }
  if (!response.ok || !result.success || !Array.isArray(result.data?.days)) {
    throw new Error(result.message || 'Unable to retrieve sales activity')
  }
  return result.data.days
}
