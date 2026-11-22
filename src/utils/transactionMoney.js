function scaledInteger(value, decimalPlaces, label) {
  // Parse decimal text directly so quantities and money never pass through binary floating point.
  const text = String(value).trim()
  const match = text.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match || (match[2]?.length || 0) > decimalPlaces) {
    throw new RangeError(`${label} must be a non-negative number with up to ${decimalPlaces} decimal places`)
  }

  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] || '').padEnd(decimalPlaces, '0') || '0')
  return whole * (10n ** BigInt(decimalPlaces)) + fraction
}

export function toTransactionCents(value) {
  return scaledInteger(value, 2, 'Amount')
}

export function transactionLineCents(quantity, unitPrice) {
  const quantityThousandths = scaledInteger(quantity, 3, 'Quantity')
  const priceCents = scaledInteger(unitPrice, 2, 'Price')
  // Match server-side per-line half-up rounding before any transaction-level sum.
  return (quantityThousandths * priceCents + 500n) / 1000n
}

export function transactionTotalCents(items) {
  // Round each line first; summing unrounded products can produce a different total.
  return items.reduce(
    (total, item) => total + transactionLineCents(item.quantity, item.selling_price),
    0n,
  )
}

export function transactionCentsToAmount(cents) {
  const value = BigInt(cents)
  const whole = value / 100n
  const fraction = String(value % 100n).padStart(2, '0')
  return `${whole}.${fraction}`
}

export function formatTransactionCents(cents, pesoFormatter) {
  const value = BigInt(cents)
  if (typeof pesoFormatter.formatToParts !== 'function') {
    return pesoFormatter.format(Number(transactionCentsToAmount(value)))
  }

  // Let Intl format the whole-unit currency parts, then restore exact cents as text.
  const absolute = value < 0n ? -value : value
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')
  const parts = pesoFormatter.formatToParts(value < 0n ? -whole : whole)
  return parts.map((part) => part.type === 'fraction' ? fraction : part.value).join('')
}
