import { authenticatedApiFetch } from './api.js'

async function request(path, options, fallback) {
  const response = await authenticatedApiFetch(path, options)
  let result
  try { result = await response.json() } catch { throw new Error(fallback) }
  if (!response.ok || !result.success) throw new Error(result.message || fallback)
  return result.data
}

export async function getCustomers(options = {}) {
  const data = await request('/customers', options, 'Unable to retrieve customers')
  if (!Array.isArray(data)) throw new Error('Customers could not be loaded. Please try again.')
  return data
}

export function createCustomer(data) {
  return request('/customers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }, 'Unable to create customer')
}

export function updateCustomer(id, data) {
  return request(`/customers/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  }, 'Unable to update customer')
}

export function getCustomer(id, options = {}) {
  return request(`/customers/${id}`, options, 'Unable to retrieve customer')
}

export async function getCustomerCredits(id, options = {}) {
  const data = await request(`/customers/${id}/credits`, options, 'Unable to retrieve customer credits')
  if (!Array.isArray(data)) throw new Error('Customer credit records could not be loaded. Please try again.')
  return data
}

export async function getCustomerPayments(id, options = {}) {
  const data = await request(`/customers/${id}/payments`, options, 'Unable to retrieve customer payments')
  if (!Array.isArray(data)) throw new Error('Customer payment records could not be loaded. Please try again.')
  return data
}
