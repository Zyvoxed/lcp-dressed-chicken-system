import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getDashboard, rankBusinessProducts } from '../controllers/dashboardController.js'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('admin dashboard keeps revenue data and ranks product quantities within each unit', async () => {
  const original = pool.execute
  const queries = []
  const rowsByQuery = [
    [{ total_revenue: '125.50', total_transactions: 4, average_sale_value: '31.375', total_products: 8, low_stock_count: 2, customer_credits: '40.00' }],
    [
      { product_id: 3, product_name: 'Chicken', unit: 'kg', quantity_sold: '7', sales_amount: '125.50', unit_rank: 1 },
      { product_id: 5, product_name: 'Eggs', unit: 'tray', quantity_sold: '4', sales_amount: '80.00', unit_rank: 1 },
    ],
    [
      { product_id: 4, product_name: 'Eggs', unit: 'tray', stock_quantity: '2', quantity_sold: '0', unit_rank: 1 },
      { product_id: 6, product_name: 'Chicken', unit: 'kg', stock_quantity: '2', quantity_sold: '1', unit_rank: 1 },
    ],
    [{ product_id: 4, product_name: 'Eggs', unit: 'tray', stock_quantity: '2', reorder_level: '5', status: 'Low Stock' }],
    [{ activity_id: 12, action: 'Sale', description: 'Sale recorded', operator_name: 'Admin' }],
    [{ bucket_index: 9, sales: '25.50', transactions: 1 }],
    [{ bucket_index: 0, sales: '25.50', transactions: 1 }],
    [{ bucket_index: 0, sales: '25.50', transactions: 1 }],
  ]
  pool.execute = async (sql) => {
    queries.push(sql)
    const result = rowsByQuery.shift()
    assert.ok(result, `Unexpected dashboard query: ${sql}`)
    return [result]
  }

  try {
    const result = response()
    await getDashboard({ user: { role: 'Admin' } }, result)

    assert.equal(result.statusCode, 200)
    assert.equal(result.body.success, true)
    const { data } = result.body
    assert.equal(data.summary.total_revenue, '125.50')
    assert.equal(data.summary.average_sale_value, '31.375')
    assert.equal(data.summary.best_seller, 'Chicken (kg) · Eggs (tray)')
    assert.equal(data.top_products[0].product_name, 'Chicken')
    assert.equal(data.top_products[1].product_name, 'Eggs')
    assert.equal(data.low_stock_alerts[0].product_name, 'Eggs')
    assert.equal(data.recent_activity[0].activity_id, 12)
    assert.equal(data.trends.daily.length, 24)
    assert.equal(data.trends.daily[9].sales, 25.5)
    assert.equal(data.trends.daily[8].sales, 0)
    assert.deepEqual(data.trends.weekly.map((entry) => entry.label), [
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ])
    assert.equal(data.trends.weekly[0].transactions, 1)
    assert.ok(data.trends.monthly.length >= 28 && data.trends.monthly.length <= 31)
    assert.equal(data.trends.monthly[0].sales, 25.5)
    assert.equal(data.trends.monthly[1].sales, 0)
    assert.equal(queries.length, 8)
    assert.match(queries[1], /PARTITION BY p\.unit/)
    assert.match(queries[2], /PARTITION BY p\.unit/)
    assert.ok(queries.slice(5).every((sql) => sql.includes("CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')")))
  } finally {
    pool.execute = original
  }
})

test('business analytics quantity rankings are independently ordered within each unit', () => {
  const ranked = rankBusinessProducts([
    { product_id: 1, product_name: 'Chicken', unit: 'kg', quantity_sold: '100', gross_sales: '500' },
    { product_id: 2, product_name: 'Eggs', unit: 'tray', quantity_sold: '10', gross_sales: '600' },
    { product_id: 3, product_name: 'Feet', unit: 'kg', quantity_sold: '20', gross_sales: '100' },
    { product_id: 4, product_name: 'Quail eggs', unit: 'tray', quantity_sold: '3', gross_sales: '100' },
  ])

  assert.deepEqual(ranked.topPerUnit.map(({ product_name, unit }) => [product_name, unit]), [
    ['Chicken', 'kg'], ['Eggs', 'tray'],
  ])
  assert.deepEqual(ranked.slowPerUnit.map(({ product_name, unit }) => [product_name, unit]), [
    ['Feet', 'kg'], ['Quail eggs', 'tray'],
  ])
  assert.deepEqual(ranked.topPerforming.map(({ product_name, unit_rank }) => [product_name, unit_rank]), [
    ['Chicken', 1], ['Feet', 2], ['Eggs', 1], ['Quail eggs', 2],
  ])
})

test('staff dashboard returns the established limited metrics and recent transactions', async () => {
  const original = pool.execute
  const queries = []
  pool.execute = async (sql) => {
    queries.push(sql)
    if (sql.includes('today_sales')) {
      return [[{ today_sales: '80.00', today_transactions: 3, outstanding_credits: '50.00', payments_today: '20.00' }]]
    }
    if (sql.includes('transaction_type')) {
      return [[{ transaction_type: 'Sale', reference_id: 6, customer_name: 'Walk-In Customer', amount: '30.00', status: 'Paid', occurred_at: '2026-11-22T08:00:00+08:00' }]]
    }
    assert.fail(`Unexpected staff dashboard query: ${sql}`)
  }

  try {
    const result = response()
    await getDashboard({ user: { role: 'Staff' } }, result)

    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body.data.summary, {
      today_sales: '80.00', today_transactions: 3, outstanding_credits: '50.00', payments_today: '20.00',
    })
    assert.equal(result.body.data.recent_transactions[0].reference_id, 6)
    assert.equal('trends' in result.body.data, false)
    assert.equal(queries.length, 2)
    assert.ok(queries.every((sql) => !sql.includes('activity_logs')))
  } finally {
    pool.execute = original
  }
})
