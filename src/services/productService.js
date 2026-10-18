import { authenticatedApiFetch } from './api.js'

export async function getProducts(options = {}) {
  const response = await authenticatedApiFetch('/products', options)

  if (!response.ok) {
    throw new Error('Products could not be loaded. Please try again.')
  }

  const result = await response.json()

  if (!result.success || !Array.isArray(result.data)) {
    throw new Error('Products could not be loaded. Please try again.')
  }

  return result.data
}
