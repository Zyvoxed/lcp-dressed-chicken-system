function toScaledInteger(value, scale, errorMessage) {
  const scaled = Math.round(Number(value) * scale)
  if (!Number.isSafeInteger(scaled)) throw new RangeError(errorMessage)
  return BigInt(scaled)
}

export function toCents(value) {
  // Validate magnitude before converting to BigInt so every persisted cent value is exact.
  return toScaledInteger(value, 100, 'Monetary value exceeds safe integer precision')
}

export function toThousandths(value) {
  // Inventory quantity is stored to three decimal places; mirror that scale in integer arithmetic.
  return toScaledInteger(value, 1000, 'Quantity exceeds safe integer precision')
}

export function lineTotalCents(quantity, unitPrice) {
  // Multiplying thousandths by cents yields thousandths of a cent; add half a cent
  // before dividing so each non-negative line is rounded half-up independently.
  const product = toThousandths(quantity) * toCents(unitPrice)
  const rounded = (product + 500n) / 1000n
  return rounded
}

export function centsToAmount(cents) {
  // Format the integer and remainder separately instead of converting back to float.
  const value = BigInt(cents)
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const whole = absolute / 100n
  const fractional = String(absolute % 100n).padStart(2, '0')
  return `${sign}${whole}.${fractional}`
}
