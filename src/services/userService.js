import { authenticatedApiFetch } from './api.js'

async function request(path = '', options = {}) {
  const response = await authenticatedApiFetch(`/users${path}`, options)
  let result
  try { result = await response.json() } catch { throw new Error('Unable to process user request') }
  if (!response.ok || !result.success) throw new Error(result.message || 'Unable to process user request')
  return result
}

export async function getUsers(options = {}) { return (await request('', options)).data }
export async function getUser(id, options = {}) { return (await request(`/${id}`, options)).data }
export async function createUser(data) { return request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) }
export async function updateUser(id, data) { return request(`/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) }
export async function updateUserStatus(id, isActive) { return request(`/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: isActive }) }) }
export async function resetUserPassword(id, newPassword) { return request(`/${id}/password`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_password: newPassword }) }) }
