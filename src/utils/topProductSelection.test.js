import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maxProductSelections,
  rankingsForYear,
  resolveProductSelection,
  selectTopProductsByUnit,
  toggleProductSelection,
} from './topProductSelection.js'

const product = (product_id, product_name, unit, quantity_sold, gross_sales = '0') => ({
  product_id, product_name, unit, quantity_sold: String(quantity_sold), gross_sales: String(gross_sales),
})

test('selects five best-ranked products round-robin within compatible units', () => {
  const ranked = selectTopProductsByUnit([
    product(1, 'Chicken A', 'kg', 90, 500),
    product(2, 'Chicken B', 'kg', 80, 400),
    product(3, 'Chicken C', 'kg', 70, 300),
    product(4, 'Eggs A', 'tray', 20, 200),
    product(5, 'Eggs B', 'tray', 10, 100),
    product(6, 'Feet A', 'piece', 5, 50),
  ])
  assert.deepEqual(ranked.map(({ product_id }) => product_id), [1, 6, 4, 2, 5])
})

test('returns all qualifying products when fewer than five exist and none when sales are zero', () => {
  assert.deepEqual(selectTopProductsByUnit([
    product(1, 'Chicken', 'kg', 1),
    product(2, 'Eggs', 'tray', 2),
    product(3, 'Beef', 'kg', 3),
  ]).map(({ product_id }) => product_id), [3, 2, 1])
  assert.deepEqual(selectTopProductsByUnit([product(4, 'Unsold', 'kg', 0)]), [])
  assert.deepEqual(selectTopProductsByUnit([]), [])
})

test('ranks a single unit by quantity and uses revenue/name as deterministic tie breakers', () => {
  assert.deepEqual(selectTopProductsByUnit([
    product(3, 'Same Name B', 'kg', 5, 10),
    product(2, 'Same Name A', 'kg', 5, 10),
    product(1, 'Higher Revenue', 'kg', 5, 11),
    product(4, 'Lower Quantity', 'kg', 4, 99),
  ]).map(({ product_id }) => product_id), [1, 2, 3, 4])
})

test('uses the selected year rankings and falls back when that year has no ranked products', () => {
  const priorYear = { ...product(1, 'Prior Year Winner', 'kg', 8, 80), sale_year: 2025 }
  const currentYear = { ...product(2, 'Current Year Winner', 'kg', 9, 90), sale_year: 2026 }
  const annualRankings = [priorYear, currentYear]
  assert.deepEqual(rankingsForYear(annualRankings, 2025), [priorYear])
  assert.deepEqual(rankingsForYear(annualRankings, 2024, [product(3, 'Fallback', 'kg', 1)]).map(({ product_name }) => product_name), ['Fallback'])
})

test('keeps valid manual choices through ranking updates and removes unavailable/duplicate IDs', () => {
  const available = [product(1, 'A', 'kg', 10), product(2, 'B', 'kg', 9), product(3, 'C', 'tray', 8)]
  assert.deepEqual(resolveProductSelection(null, ['2', 1], available), ['2', '1'])
  assert.deepEqual(resolveProductSelection(['2', '2', '99'], ['1'], available), ['2'])
  assert.deepEqual(resolveProductSelection([], ['1', '2'], available), [])
})

test('manual toggling supports deselect/add and enforces the five-product limit', () => {
  assert.deepEqual(toggleProductSelection(['1', '2'], 2), ['1'])
  assert.deepEqual(toggleProductSelection(['1'], 3), ['1', '3'])
  const full = ['1', '2', '3', '4', '5']
  assert.equal(toggleProductSelection(full, 6), full)
  assert.equal(maxProductSelections, 5)
})
