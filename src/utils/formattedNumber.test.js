import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countNumericCharacters,
  formatNumberInput,
  formattedCaretPosition,
  normalizeNumericInput,
} from './formattedNumber.js'

test('formats whole and decimal amounts without changing their numeric text', () => {
  for (const [raw, formatted] of [
    ['1000', '1,000'],
    ['16000', '16,000'],
    ['1250000', '1,250,000'],
    ['1000.25', '1,000.25'],
    ['1000.', '1,000.'],
    ['0.50', '0.50'],
  ]) {
    assert.equal(formatNumberInput(raw), formatted)
    assert.equal(normalizeNumericInput(formatted), raw)
  }
})

test('normalizes pasted formatted numbers and ignores grouping separators', () => {
  assert.equal(normalizeNumericInput('1,250,000.75'), '1250000.75')
  assert.equal(formatNumberInput('1,250,000.75'), '1,250,000.75')
})

test('preserves editable empty and decimal intermediate states', () => {
  assert.equal(formatNumberInput(''), '')
  assert.equal(formatNumberInput('.'), '.')
  assert.equal(formatNumberInput('1000.'), '1,000.')
})

test('maps caret position across inserted separators when editing in the middle', () => {
  const formatted = formatNumberInput('1234567.89')
  const rawCaret = countNumericCharacters('12,34')
  assert.equal(formatted, '1,234,567.89')
  assert.equal(formattedCaretPosition(formatted, rawCaret), 5)
})
