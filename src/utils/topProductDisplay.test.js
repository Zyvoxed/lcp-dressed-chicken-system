import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTopSellerNames } from './topProductDisplay.js'

test('formats top seller product names without quantity or unit suffixes', () => {
  assert.equal(formatTopSellerNames([
    { product_name: 'Chicken', quantity_sold: '7', unit: 'kg' },
    { product_name: 'Eggs', quantity_sold: '4.000', unit: 'tray' },
    { product_name: 'Whole Chicken', quantity_sold: '125.500', unit: 'kg' },
  ]), 'Chicken · Eggs · Whole Chicken')
})

test('returns an empty string for no top products', () => {
  assert.equal(formatTopSellerNames([]), '')
})
