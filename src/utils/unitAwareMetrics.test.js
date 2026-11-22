import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  formatQuantityWithUnit,
  groupByUnit,
  scaleSeriesByUnit,
  sumQuantitiesByUnit,
} from './unitAwareMetrics.js'

test('unit formatting retains each configured product unit', () => {
  assert.equal(formatQuantityWithUnit(2, 'kg'), '2 kg')
  assert.equal(formatQuantityWithUnit(3.5, 'tray'), '3.5 tray')
})

test('quantity totals remain separate for incompatible units', () => {
  const totals = sumQuantitiesByUnit([
    { unit: 'kg', quantity_received: '2.5' },
    { unit: 'tray', quantity_received: '4' },
    { unit: 'kg', quantity_received: '1.5' },
  ], (record) => record.quantity_received)

  assert.deepEqual(totals, [
    { unit: 'kg', quantity: 4 },
    { unit: 'tray', quantity: 4 },
  ])
})

test('grouping keeps product entries and unit-specific share denominators independent', () => {
  const products = [
    { product_name: 'Chicken', unit: 'kg', quantity: 6 },
    { product_name: 'Feet', unit: 'kg', quantity: 2 },
    { product_name: 'Eggs', unit: 'tray', quantity: 4 },
  ]
  const groups = groupByUnit(products)
  const shares = groups.map(({ unit, items }) => ({
    unit,
    shares: items.map((item) => item.quantity / items.reduce((sum, entry) => sum + entry.quantity, 0)),
  }))

  assert.deepEqual(shares, [
    { unit: 'kg', shares: [0.75, 0.25] },
    { unit: 'tray', shares: [1] },
  ])
})

test('chart series use independent quantity scales for each configured unit', () => {
  const groups = scaleSeriesByUnit([
    { name: 'Chicken', unit: 'kg', values: [100, 80] },
    { name: 'Feet', unit: 'kg', values: [40, 30] },
    { name: 'Eggs', unit: 'tray', values: [4, 2] },
  ])

  assert.deepEqual(groups.map(({ unit, maximum, items }) => [unit, maximum, items.map((item) => item.name)]), [
    ['kg', 115, ['Chicken', 'Feet']],
    ['tray', 5, ['Eggs']],
  ])
})

test('quantity chart components render values in their configured unit groups', async () => {
  const plot = await readFile(new URL('../pages/Dashboard/ProductSalesTrendPlot.jsx', import.meta.url), 'utf8')
  const procurement = await readFile(new URL('../pages/SupplierContracts/ProcurementChart.jsx', import.meta.url), 'utf8')

  assert.match(plot, /chartModel\.unitGroups\.map/)
  assert.match(plot, /formatQuantityWithUnit\(tick\.value, group\.unit/)
  assert.match(plot, /formatQuantityWithUnit\(tooltip\.point\.value, tooltip\.point\.unit/)
  assert.doesNotMatch(plot, /\bkg\b/)
  assert.match(procurement, /productGroups\.map\(\(\{ unit, items \}\)/)
  assert.match(procurement, /formatQuantityWithUnit\(tick, unit/)
  assert.doesNotMatch(procurement, /Share of Procurement|share:/)
})
