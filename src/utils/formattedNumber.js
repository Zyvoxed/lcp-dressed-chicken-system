export function normalizeNumericInput(value) {
  const source = String(value ?? '').replace(/,/g, '')
  let result = ''
  let hasDecimal = false

  for (const character of source) {
    if (character >= '0' && character <= '9') {
      result += character
    } else if (character === '.' && !hasDecimal) {
      result += character
      hasDecimal = true
    }
  }

  return result
}

export function formatNumberInput(value) {
  const raw = normalizeNumericInput(value)
  const [whole, ...fractionParts] = raw.split('.')
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fractionParts.length ? `${groupedWhole}.${fractionParts[0]}` : groupedWhole
}

export function countNumericCharacters(value) {
  return String(value ?? '').replace(/,/g, '').length
}

export function formattedCaretPosition(formattedValue, numericCharacterCount) {
  if (numericCharacterCount <= 0) return 0

  let count = 0
  for (let index = 0; index < formattedValue.length; index += 1) {
    if (formattedValue[index] !== ',') count += 1
    if (count === numericCharacterCount) return index + 1
  }

  return formattedValue.length
}
