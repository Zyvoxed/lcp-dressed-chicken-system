import { authenticatedApiFetch } from './api.js'

export async function getActivityLogs(parameters = {}, options = {}) {
  const query = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) query.set(key, value)
  })
  const response = await authenticatedApiFetch(`/activity-logs?${query}`, options)
  let result
  try { result = await response.json() } catch { throw new Error('Unable to load activity logs') }
  if (!response.ok || !result.success) throw new Error(result.message || 'Unable to load activity logs')
  return result
}
