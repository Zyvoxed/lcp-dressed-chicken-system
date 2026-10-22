export const decimalLimits = Object.freeze({
  quantity: 9999999.999,
  unitPrice: 99999999.99,
  money: 9999999999.99,
})

export class DecimalValidationError extends Error {}

function decimalPlaces(text) {
  const match = text.match(/^\d+(?:\.(\d+))?(?:e([+-]?\d+))?$/i)
  if (!match) return null

  const fraction = (match[1] || '').replace(/0+$/, '')
  const exponent = Number(match[2] || 0)
  return Math.max(fraction.length - exponent, 0)
}

export function parseDecimal(value, {
  fieldName,
  maximum,
  decimalPlaces: maximumDecimalPlaces,
  minimum = 0,
  inclusiveMinimum = true,
}) {
  const supportedType = typeof value === 'number' || typeof value === 'string'
  const raw = supportedType ? String(value).trim() : ''

  if (!supportedType || !raw) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(raw)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new DecimalValidationError(`${fieldName} must be a valid number`)
  }

  const negativeSyntax = raw.startsWith('-')
  const validMinimum = inclusiveMinimum ? parsed >= minimum : parsed > minimum
  if (negativeSyntax || !validMinimum) {
    throw new DecimalValidationError(
      inclusiveMinimum
        ? `${fieldName} must be at least ${minimum}`
        : `${fieldName} must be greater than ${minimum}`,
    )
  }

  if (parsed > maximum) {
    throw new DecimalValidationError(`${fieldName} must not exceed ${maximum}`)
  }

  const precision = decimalPlaces(raw)
  if (precision === null || precision > maximumDecimalPlaces) {
    throw new DecimalValidationError(
      `${fieldName} supports up to ${maximumDecimalPlaces} decimal places`,
    )
  }

  return parsed
}
