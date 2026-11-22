import assert from 'node:assert/strict'
import test from 'node:test'
import { getDeliveryChartTicks, getStaffSupplierMetrics } from './staffSupplierMetrics.js'

const now = new Date('2026-11-23T12:00:00+08:00')

test('Staff supplier delivery metrics count distinct selected supplier batches in Manila calendar months', () => {
  const records = [
    { stockin_id: 1, supplier_id: 7, product_name: 'Chicken', unit: 'kg', quantity_received: '20.000', delivery_date: '2026-06-30T23:30:00+08:00' },
    { stockin_id: 2, supplier_id: 7, product_name: 'Wings', unit: 'kg', quantity_received: '4.000', delivery_date: '2026-07-01T00:05:00+08:00' },
    // A duplicated row ID must not inflate counts if an upstream read ever repeats a batch.
    { stockin_id: 2, supplier_id: 7, product_name: 'Wings', unit: 'kg', quantity_received: '4.000', delivery_date: '2026-07-01T00:05:00+08:00' },
    { stockin_id: 3, supplier_id: 7, product_name: 'Liver', unit: 'piece', quantity_received: '12.000', delivery_date: '2026-11-22T23:50:00+08:00' },
    { stockin_id: 4, supplier_id: 9, product_name: 'Other', unit: 'kg', quantity_received: '100.000', delivery_date: '2026-11-22T10:00:00+08:00' },
  ]

  const metrics = getStaffSupplierMetrics(records, 7, now)

  assert.equal(metrics.totalDeliveries, 3)
  assert.equal(metrics.lastDelivery.stockin_id, 3)
  assert.deepEqual(metrics.monthlyActivity.map(({ key, deliveries }) => [key, deliveries]), [
    ['2026-06', 1], ['2026-07', 1], ['2026-08', 0],
    ['2026-09', 0], ['2026-10', 0], ['2026-11', 1],
  ])
  assert.equal(metrics.monthlyActivity[0].tooltipLabel, 'June 2026')
  assert.deepEqual(metrics.recentDeliveries.map((record) => record.stockin_id), [3, 2, 1])
  assert.equal(metrics.recentDeliveries[0].unit, 'piece')
})

test('Staff supplier metrics exclude explicit void records and ignore records outside the six displayed months', () => {
  const records = [
    { stockin_id: 1, supplier_id: 7, delivery_date: '2026-05-31T23:59:00+08:00' },
    { stockin_id: 2, supplier_id: 7, delivery_date: '2026-11-20T12:00:00+08:00', status: 'Voided' },
    { stockin_id: 3, supplier_id: 7, delivery_date: '2026-11-19T12:00:00+08:00', status: 'Posted' },
  ]

  const metrics = getStaffSupplierMetrics(records, 7, now)
  assert.equal(metrics.totalDeliveries, 2)
  assert.deepEqual(metrics.monthlyActivity.map((item) => item.deliveries), [0, 0, 0, 0, 0, 1])
  assert.deepEqual(metrics.recentDeliveries.map((record) => record.stockin_id), [3, 1])
})

test('Staff supplier metrics return zeroed months and no delivery date when the supplier has no receipts', () => {
  const metrics = getStaffSupplierMetrics([], 7, now)
  assert.equal(metrics.totalDeliveries, 0)
  assert.equal(metrics.lastDelivery, null)
  assert.equal(metrics.recentDeliveries.length, 0)
  assert.deepEqual(metrics.monthlyActivity.map((item) => item.deliveries), [0, 0, 0, 0, 0, 0])
})

test('delivery chart ticks are descending whole numbers and include zero and the domain maximum', () => {
  assert.deepEqual(getDeliveryChartTicks(1), [1, 0])
  assert.deepEqual(getDeliveryChartTicks(2), [2, 1, 0])
  assert.deepEqual(getDeliveryChartTicks(5), [5, 3, 0])
  assert.ok(getDeliveryChartTicks(5).every(Number.isInteger))
})
