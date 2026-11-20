const quantityPattern = /^\d+(?:\.\d{1,3})?$/

export function parseQuantityThousandths(value) {
  const text = String(value ?? '').trim()
  if (!quantityPattern.test(text)) return null

  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0') || '0')
}

export function formatQuantityInput(value) {
  const quantity = typeof value === 'bigint' ? value : parseQuantityThousandths(value)
  if (quantity === null || quantity < 0n) return String(value ?? '')

  const whole = quantity / 1000n
  const fraction = String(quantity % 1000n).padStart(3, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function quantityThousandthsToNumber(value) {
  return Number(value) / 1000
}

export function initialAddQuantity(stockQuantity, currentQuantity = 0) {
  const stock = parseQuantityThousandths(stockQuantity)
  const current = parseQuantityThousandths(currentQuantity)
  if (stock === null || current === null) return '1'

  const available = stock - current
  if (available <= 0n) return '1'
  return formatQuantityInput(available < 1000n ? available : 1000n)
}

export function validateQuantityEntry({ value, stockQuantity, currentQuantity = 0, mode, unit = 'kg' }) {
  const text = String(value ?? '').trim()
  if (!text) return { error: 'Enter a quantity.' }

  const requested = parseQuantityThousandths(text)
  if (requested === null) {
    return { error: 'Enter a valid quantity with up to 3 decimal places.' }
  }
  if (requested <= 0n) return { error: 'Quantity must be greater than zero.' }

  const stock = parseQuantityThousandths(stockQuantity)
  if (stock === null) return { error: 'Available stock could not be validated. Refresh the product list and try again.' }

  const current = mode === 'add' ? parseQuantityThousandths(currentQuantity) : 0n
  if (current === null) return { error: 'The current cart quantity could not be validated. Reopen the quantity editor and try again.' }

  const resultingQuantity = requested + current
  if (resultingQuantity > stock) {
    const available = stock > current ? stock - current : 0n
    return {
      error: `Quantity exceeds available stock. You can add up to ${formatQuantityInput(available)} ${unit}.`,
      availableQuantity: available,
    }
  }

  return { quantityThousandths: requested, resultingQuantity }
}

export function applyCartQuantitySelection(cart, product, mode, quantityThousandths) {
  const quantity = quantityThousandthsToNumber(quantityThousandths)

  if (mode === 'edit') {
    return cart.map((item) => item.product_id === product.product_id
      ? { ...item, quantity }
      : item)
  }

  const existing = cart.find((item) => item.product_id === product.product_id)
  if (existing) {
    const currentQuantity = parseQuantityThousandths(existing.quantity)
    if (currentQuantity === null) return cart
    const updatedQuantity = quantityThousandthsToNumber(currentQuantity + quantityThousandths)
    return cart.map((item) => item.product_id === product.product_id
      ? { ...item, quantity: updatedQuantity }
      : item)
  }

  return [...cart, { ...product, quantity }]
}
