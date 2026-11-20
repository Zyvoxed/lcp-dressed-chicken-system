import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCartQuantitySelection,
  formatQuantityInput,
  initialAddQuantity,
  parseQuantityThousandths,
  validateQuantityEntry,
} from './quantityInput.js'

test('quantity parsing preserves three-decimal precision exactly', () => {
  for (const [text, expected] of [
    ['1', 1000n],
    ['0.5', 500n],
    ['0.01', 10n],
    ['0.001', 1n],
  ]) {
    assert.equal(parseQuantityThousandths(text), expected)
  }
})

test('quantity formatting removes only insignificant trailing zeros', () => {
  assert.equal(formatQuantityInput(1000n), '1')
  assert.equal(formatQuantityInput(500n), '0.5')
  assert.equal(formatQuantityInput(10n), '0.01')
  assert.equal(formatQuantityInput(1n), '0.001')
})

test('empty and partial decimal states remain invalid only at confirmation', () => {
  for (const value of ['', '0.']) {
    assert.equal(parseQuantityThousandths(value), null)
    assert.ok(validateQuantityEntry({ value, stockQuantity: '2', mode: 'edit' }).error)
  }
  assert.equal(parseQuantityThousandths('0.00'), 0n)
  assert.match(validateQuantityEntry({ value: '0.00', stockQuantity: '2', mode: 'edit' }).error, /greater than zero/i)
  assert.equal(parseQuantityThousandths('0.001'), 1n)
})

test('quantity validation rejects empty, zero, negative, malformed, and over-precision values', () => {
  for (const value of ['', '0', '-1', '1e2', '.5', '1.0001']) {
    assert.ok(validateQuantityEntry({ value, stockQuantity: '2', mode: 'edit' }).error, value)
  }
})

test('quantity validation enforces stock for add and edit modes', () => {
  assert.equal(validateQuantityEntry({ value: '0.5', stockQuantity: '1', currentQuantity: '0.5', mode: 'add' }).error, undefined)
  assert.match(validateQuantityEntry({ value: '0.6', stockQuantity: '1', currentQuantity: '0.5', mode: 'add' }).error, /available stock/i)
  assert.match(validateQuantityEntry({ value: '1.001', stockQuantity: '1', mode: 'edit' }).error, /available stock/i)
})

test('default add quantity respects fractional stock remaining', () => {
  assert.equal(initialAddQuantity('0.5'), '0.5')
  assert.equal(initialAddQuantity('2', '1.75'), '0.25')
  assert.equal(initialAddQuantity('1', '1'), '1')
})

test('adding a selected quantity merges into an existing cart item without duplicating it', () => {
  const product = { product_id: 4, product_name: 'Chicken', stock_quantity: '2', quantity: 0.5 }
  const cart = [product]
  const updated = applyCartQuantitySelection(cart, product, 'add', 250n)

  assert.equal(updated.length, 1)
  assert.equal(updated[0].product_id, 4)
  assert.equal(updated[0].quantity, 0.75)
  assert.equal(cart[0].quantity, 0.5)
})

test('editing a cart quantity updates the matching item and preserves other products', () => {
  const chicken = { product_id: 4, product_name: 'Chicken', quantity: 0.5 }
  const liver = { product_id: 5, product_name: 'Liver', quantity: 1 }
  const updated = applyCartQuantitySelection([chicken, liver], chicken, 'edit', 10n)

  assert.equal(updated.length, 2)
  assert.equal(updated[0].product_id, 4)
  assert.equal(updated[0].quantity, 0.01)
  assert.equal(updated[1], liver)
})
