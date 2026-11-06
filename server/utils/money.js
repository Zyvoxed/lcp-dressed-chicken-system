export function toCents(value) {
  const cents = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(cents)) throw new RangeError('Monetary value exceeds safe integer precision')
  return BigInt(cents)
}

export function toThousandths(value) {
  const thousandths = Math.round(Number(value) * 1000)
  if (!Number.isSafeInteger(thousandths)) throw new RangeError('Quantity exceeds safe integer precision')
  return BigInt(thousandths)
}

// Transaction totals round each line half-up to cents before summing.
export function lineTotalCents(quantity, unitPrice) {
  const product = toThousandths(quantity) * toCents(unitPrice)
  const rounded = (product + 500n) / 1000n
  return rounded
}

export function centsToAmount(cents) {
  const value = BigInt(cents)
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const whole = absolute / 100n
  const fractional = String(absolute % 100n).padStart(2, '0')
  return `${sign}${whole}.${fractional}`
}
