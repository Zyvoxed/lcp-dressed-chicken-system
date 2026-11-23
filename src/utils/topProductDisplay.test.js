import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTopSellersByUnit } from './topProductDisplay.js'

test('formats integer and decimal top quantities with units and no unnecessary zeroes', () => {
  assert.equal(formatTopSellersByUnit([
    { product_name: 'Chicken', quantity_sold: '7', unit: 'kg' },
    { product_name: 'Eggs', quantity_sold: '4.000', unit: 'tray' },
    { product_name: 'Whole Chicken', quantity_sold: '125.500', unit: 'kg' },
  ]), 'Chicken (7 kg) · Eggs (4 tray) · Whole Chicken (125.5 kg)')
})

test('groups large quantities and preserves supported fractional precision', () => {
  assert.equal(formatTopSellersByUnit([
    { product_name: 'Chicken Wings', quantity_sold: '1250.500', unit: 'kg' },
    { product_name: 'Gizzards', quantity_sold: '12.375', unit: 'kg' },
  ]), 'Chicken Wings (1,250.5 kg) · Gizzards (12.375 kg)')
})

test('returns an empty string for no top products', () => {
  assert.equal(formatTopSellersByUnit([]), '')
})
