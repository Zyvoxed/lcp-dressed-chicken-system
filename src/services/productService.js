import { authenticatedApiFetch } from './api.js'

async function parseResponse(response, fallbackMessage) {
  let result

  try {
    result = await response.json()
  } catch {
    throw new Error(fallbackMessage)
  }

  if (!response.ok || !result.success) {
    throw new Error(result.message || fallbackMessage)
  }

  return result
}

export async function getProducts(options = {}) {
  const response = await authenticatedApiFetch('/products', options)
  const result = await parseResponse(response, 'Products could not be loaded. Please try again.')

  if (!Array.isArray(result.data)) {
    throw new Error('Products could not be loaded. Please try again.')
  }

  return result.data
}

export async function createProduct(data) {
  const response = await authenticatedApiFetch('/products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  const result = await parseResponse(response, 'Unable to create product')

  if (!result.data?.product_id) {
    throw new Error('The product result could not be read. Check the product list before trying again.')
  }

  return result.data
}

export async function updateProduct(productId, data) {
  const response = await authenticatedApiFetch(`/products/${productId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  const result = await parseResponse(response, 'Unable to update product')

  if (!result.data?.product_id) {
    throw new Error('The updated product could not be read. Refresh the product list before trying again.')
  }

  return result.data
}
