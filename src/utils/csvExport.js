const NUMERIC_VALUE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const FORMULA_PREFIX = /^[=+\-@]/

function leadingSpaceOrControlLength(text) {
  let length = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    const isControl = codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
    if (!/\s/u.test(character) && !isControl) break
    length += character.length
  }
  return length
}

function isNumericValue(value, text) {
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && NUMERIC_VALUE.test(text)
}

function neutralizeFormulaText(value, text) {
  if (isNumericValue(value, text)) return text

  const firstMeaningfulCharacter = text.slice(leadingSpaceOrControlLength(text))
  return FORMULA_PREFIX.test(firstMeaningfulCharacter) ? `'${text}` : text
}

export function escapeCsv(value) {
  const text = neutralizeFormulaText(value, String(value ?? ''))
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildCsv(columns, rows) {
  return [columns, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')
}

export function manilaDateStamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

export function exportCsv(filename, columns, rows) {
  const blob = new Blob([buildCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
