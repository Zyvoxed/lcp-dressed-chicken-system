const storagePrefix = 'lcp.pending-transaction.v2'
const legacyStoragePrefix = 'lcp.pending-transaction.v1'
const supportedOperations = new Set(['sale', 'stock_in', 'payment'])
const integerIdMaximum = 2147483647n
const quantityMaximum = 9999999999n
const unitPriceMaximumCents = 9999999999n
const moneyMaximumCents = 999999999999n

function storageKey(operation, userId) {
  if (!supportedOperations.has(operation)) {
    throw new Error('Unsupported transaction type')
  }
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
    throw new Error('A valid authenticated user is required for transaction recovery')
  }
  return `${storagePrefix}.${Number(userId)}.${operation}`
}

function storageError(error) {
  return new Error(`Unable to preserve this pending transaction in this browser: ${error.message}`)
}

function isPositiveId(value) {
  if (!/^\d+$/.test(String(value))) return false
  const parsed = BigInt(value)
  return parsed > 0n && parsed <= integerIdMaximum
}

function scaledValue(value, decimalPlaces) {
  const text = String(value).trim()
  const match = text.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  const fraction = (match[2] || '').replace(/0+$/, '')
  if (fraction.length > decimalPlaces) return null
  return BigInt(match[1]) * (10n ** BigInt(decimalPlaces))
    + BigInt((match[2] || '').padEnd(decimalPlaces, '0') || '0')
}

function isValidQuantity(value, positive = true) {
  const scaled = scaledValue(value, 3)
  return scaled !== null
    && scaled <= quantityMaximum
    && (positive ? scaled > 0n : true)
}

function isValidMoney(value, positive = false, maximum = moneyMaximumCents) {
  const cents = scaledValue(value, 2)
  return cents !== null
    && cents <= maximum
    && (positive ? cents > 0n : true)
}

function saleTotalCents(items) {
  return items.reduce((total, item) => {
    const quantity = scaledValue(item.quantity, 3)
    const price = scaledValue(item.selling_price, 2)
    if (quantity === null || price === null) return null
    return total + (quantity * price + 500n) / 1000n
  }, 0n)
}

function containsCredentials(value) {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, nestedValue]) => (
    /password|authorization|token/i.test(key)
    || containsCredentials(nestedValue)
  ))
}

function validateAttempt(operation, attempt) {
  if (
    typeof attempt?.key !== 'string'
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(attempt.key)
    || !attempt.payload
    || typeof attempt.payload !== 'object'
    || Array.isArray(attempt.payload)
    || !attempt.display
    || typeof attempt.display !== 'object'
    || Array.isArray(attempt.display)
    || containsCredentials(attempt)
    || !['pending', 'completed', 'rejected'].includes(attempt.state)
    || (attempt.state === 'completed' && (!attempt.response || typeof attempt.response !== 'object'))
    || (attempt.state === 'rejected'
      && (attempt.rejection?.code !== 'TRANSACTION_REJECTED'
        || attempt.rejection?.outcome !== 'not_committed'
        || !Number.isInteger(attempt.rejection?.status)
        || typeof attempt.rejection?.message !== 'string'))
  ) {
    throw new Error('The saved transaction recovery data is invalid')
  }

  if (operation === 'sale') {
    const totalCents = Array.isArray(attempt.payload.items)
      && Array.isArray(attempt.display?.cart)
      && attempt.payload.items.length === attempt.display.cart.length
      ? saleTotalCents(attempt.display.cart)
      : null
    const itemsMatch = Array.isArray(attempt.payload.items)
      && Array.isArray(attempt.display?.cart)
      && attempt.payload.items.length === attempt.display.cart.length
      && attempt.payload.items.every((item, index) => (
        isPositiveId(item.product_id)
        && isValidQuantity(item.quantity)
        && Number(item.product_id) === Number(attempt.display.cart[index]?.product_id)
        && scaledValue(item.quantity, 3) === scaledValue(attempt.display.cart[index]?.quantity, 3)
      ))
    if (
      !Array.isArray(attempt.payload.items)
      || !attempt.payload.items.length
      || !Array.isArray(attempt.display?.cart)
      || attempt.display.cart.length !== attempt.payload.items.length
      || !itemsMatch
      || attempt.display.cart.some((item) => (
        !isPositiveId(item.product_id)
        || typeof item.product_name !== 'string'
        || !item.product_name.trim()
        || !isValidMoney(item.selling_price, false, unitPriceMaximumCents)
        || !isValidQuantity(item.quantity)
      ))
      || !['Cash', 'Credit'].includes(attempt.payload.payment_type)
      || (attempt.payload.payment_type === 'Credit' && !isPositiveId(attempt.payload.customer_id))
      || (attempt.payload.customer_id !== null && attempt.payload.customer_id !== undefined
        && !isPositiveId(attempt.payload.customer_id))
      || !isValidMoney(attempt.payload.amount_paid)
      || totalCents === null
      || totalCents > moneyMaximumCents
      || scaledValue(attempt.payload.amount_paid, 2) > totalCents
      || (attempt.state === 'completed'
        && (!isPositiveId(attempt.response.sale_id)
          || !isValidMoney(attempt.response.total_amount)
          || !isValidMoney(attempt.response.amount_paid)
          || !isValidMoney(attempt.response.remaining_balance)))
    ) {
      throw new Error('The saved sale recovery data is incomplete')
    }
  }

  if (operation === 'stock_in') {
    const quantity = scaledValue(attempt.payload.quantity_received, 3)
    const costPrice = scaledValue(attempt.payload.cost_price, 2)
    const totalCost = quantity !== null && costPrice !== null
      ? (quantity * costPrice + 500n) / 1000n
      : null
    if (
      !isPositiveId(attempt.payload.supplier_id)
      || !isPositiveId(attempt.payload.product_id)
      || !isValidQuantity(attempt.payload.quantity_received)
      || !isValidMoney(attempt.payload.cost_price, false, unitPriceMaximumCents)
      || totalCost === null
      || totalCost > moneyMaximumCents
      || typeof attempt.payload.delivery_date !== 'string'
      || Number.isNaN(new Date(attempt.payload.delivery_date).getTime())
      || !attempt.display?.product?.product_name
      || !attempt.display.product.unit
      || !attempt.display?.supplier?.supplier_name
      || (attempt.state === 'completed'
        && (!isPositiveId(attempt.response.stockin_id)
          || !isValidQuantity(attempt.response.quantity_received)
          || !isValidMoney(attempt.response.cost_price, false, unitPriceMaximumCents)
          || !isValidMoney(attempt.response.total_cost)))
    ) {
      throw new Error('The saved stock-in recovery data is incomplete')
    }
  }

  if (operation === 'payment') {
    if (
      !isPositiveId(attempt.payload.sale_id)
      || !isValidMoney(attempt.payload.payment_amount, true)
      || !isPositiveId(attempt.display?.customer_id)
      || typeof attempt.display?.customer_name !== 'string'
      || !attempt.display.customer_name.trim()
      || !isPositiveId(attempt.display?.credit?.sale_id)
      || Number(attempt.payload.sale_id) !== Number(attempt.display.credit.sale_id)
      || (attempt.state === 'completed'
        && !isValidPaymentResponse(attempt, attempt.response))
    ) {
      if (!isPositiveId(attempt.display?.customer_id) || !attempt.display?.customer_name?.trim()) {
        throw new Error('The saved payment has no verified customer identity and must be resolved before recovery')
      }
      throw new Error('The saved payment recovery data is incomplete')
    }
  }
}

function isValidPaymentResponse(attempt, response) {
  const paymentAmount = scaledValue(attempt.payload.payment_amount, 2)
  return isPositiveId(response?.payment_id)
    && isPositiveId(response?.sale_id)
    && Number(response.sale_id) === Number(attempt.payload.sale_id)
    && isValidMoney(response.payment_amount, true)
    && scaledValue(response.payment_amount, 2) === paymentAmount
    && isValidMoney(response.remaining_balance)
    && (response.customer_id === undefined
      || Number(response.customer_id) === Number(attempt.display.customer_id))
}

export function validatePaymentResponse(attempt, response) {
  if (!isValidPaymentResponse(attempt, response)) {
    throw new Error('The saved payment result does not match the original customer and payment. Keep the attempt and contact an administrator.')
  }
}

export function readPendingTransaction(operation, userId) {
  try {
    const key = storageKey(operation, userId)
    const stored = sessionStorage.getItem(key)
    if (!stored) {
      if (sessionStorage.getItem(`${legacyStoragePrefix}.${operation}`)) {
        throw new Error('An unscoped legacy transaction exists and cannot safely be assigned to this user. Have an administrator verify its outcome before starting a replacement.')
      }
      return null
    }
    const record = JSON.parse(stored)
    if (Number(record?.userId) !== Number(userId)) {
      throw new Error('The saved transaction belongs to a different authenticated user')
    }
    const attempt = record.attempt
    validateAttempt(operation, attempt)
    return attempt
  } catch (error) {
    throw storageError(error)
  }
}

export function savePendingTransaction(operation, userId, attempt) {
  try {
    const key = storageKey(operation, userId)
    validateAttempt(operation, attempt)
    sessionStorage.setItem(key, JSON.stringify({ userId: Number(userId), attempt }))
  } catch (error) {
    throw storageError(error)
  }
}

export function clearPendingTransaction(operation, userId) {
  try {
    sessionStorage.removeItem(storageKey(operation, userId))
  } catch (error) {
    throw storageError(error)
  }
}
