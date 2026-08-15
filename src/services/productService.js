import { apiFetch } from './api.js'

export async function getProducts(options = {}) {
  const response = await apiFetch('/products', options)

  if (!response.ok) {
    throw new Error(`Unable to retrieve products (HTTP ${response.status})`)
  }

  const result = await response.json()

  if (!result.success || !Array.isArray(result.data)) {
    throw new Error('The products API returned an invalid response')
  }

  return result.data
}
