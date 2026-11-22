import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateProcurementMetrics } from './procurementMetrics.js'

test('procurement quantities and product totals stay grouped by configured unit', () => {
  const metrics = aggregateProcurementMetrics([
    { product_id: 1, product_name: 'Chicken', unit: 'kg', quantity_received: '2.5', total_cost: '250.00' },
    { product_id: 2, product_name: 'Eggs', unit: 'tray', quantity_received: '4', total_cost: '400.00' },
    { product_id: 1, product_name: 'Chicken', unit: 'kg', quantity_received: '1.5', total_cost: '150.00' },
  ])

  assert.deepEqual(metrics.quantitiesByUnit, [
    { unit: 'kg', quantity: 4 },
    { unit: 'tray', quantity: 4 },
  ])
  assert.deepEqual(metrics.productsByUnit.map(({ unit, items }) => [
    unit,
    items.map(({ product_name, quantity, total_cost, deliveries }) => ({ product_name, quantity, total_cost, deliveries })),
  ]), [
    ['kg', [{ product_name: 'Chicken', quantity: 4, total_cost: 400, deliveries: 2 }]],
    ['tray', [{ product_name: 'Eggs', quantity: 4, total_cost: 400, deliveries: 1 }]],
  ])
  assert.ok(metrics.productsByUnit.every(({ items }) => items.every((item) => !('share' in item))))
  assert.equal(metrics.totalCost, 800)
  assert.equal(metrics.deliveryBatches, 3)
})
