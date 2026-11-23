import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getDashboard, getStaffSalesActivity, rankBusinessProducts } from '../controllers/dashboardController.js'

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
    assert.equal(data.summary.best_seller, 'Chicken (7 kg) · Eggs (4 tray)')
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

test('admin dashboard displays the database-aggregated decimal top-product quantity', async () => {
  const original = pool.execute
  const rowsByQuery = [
    [{ total_revenue: '15750.00', total_transactions: 1, average_sale_value: '15750.00', total_products: 1, low_stock_count: 0, customer_credits: '0.00' }],
    [{ product_id: 18, product_name: 'Whole Chicken', unit: 'kg', quantity_sold: '125.500', sales_amount: '15750.00', unit_rank: 1 }],
    [],
    [],
    [],
    [],
    [],
    [],
  ]
  pool.execute = async () => {
    const result = rowsByQuery.shift()
    assert.ok(result, 'Unexpected dashboard query')
    return [result]
  }

  try {
    const result = response()
    await getDashboard({ user: { role: 'Admin' } }, result)
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.data.summary.best_seller, 'Whole Chicken (125.5 kg)')
  } finally {
    pool.execute = original
  }
})

test('admin dashboard has no top-product display when there are no qualifying sales items', async () => {
  const original = pool.execute
  const rowsByQuery = [
    [{ total_revenue: '0.00', total_transactions: 0, average_sale_value: '0.00', total_products: 1, low_stock_count: 1, customer_credits: '0.00' }],
    [],
    [{ product_id: 18, product_name: 'Whole Chicken', unit: 'kg', stock_quantity: '12.000', quantity_sold: '0', unit_rank: 1 }],
    [],
    [],
    [],
    [],
    [],
  ]
  pool.execute = async () => {
    const result = rowsByQuery.shift()
    assert.ok(result, 'Unexpected dashboard query')
    return [result]
  }

  try {
    const result = response()
    await getDashboard({ user: { role: 'Admin' } }, result)
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.data.summary.best_seller, null)
    assert.deepEqual(result.body.data.top_products, [])
    assert.equal(result.body.data.low_products[0].quantity_sold, '0')
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

test('staff dashboard returns operational metrics without monetary sales or payment totals', async () => {
  const original = pool.execute
  const queries = []
  pool.execute = async (sql) => {
    queries.push(sql)
    if (sql.includes('today_transactions')) {
      return [[{ today_transactions: 3, outstanding_credits: '50.00' }]]
    }
    if (sql.includes('transaction_type')) {
      return [[{ transaction_type: 'Sale', reference_id: 6, customer_name: 'Walk-In Customer', status: 'Paid', occurred_at: '2026-11-22T08:00:00+08:00' }]]
    }
    if (sql.includes('stock_quantity <= reorder_level')) return [[{ product_id: 2, product_name: 'Low Stock', unit: 'tray', stock_quantity: '1.000', reorder_level: '2.000', status: 'Low Stock' }]]
    if (sql.includes('GROUP BY p.unit')) return [[{ unit: 'kg', total_quantity: '2.000' }]]
    if (sql.includes('FROM stock_in si')) return [[{ stockin_id: 9, supplier_name: 'Supplier', product_name: 'Chicken', unit: 'kg', quantity_received: '3.000', delivery_date: '2026-11-22T07:00:00+08:00' }]]
    assert.fail(`Unexpected staff dashboard query: ${sql}`)
  }

  try {
    const result = response()
    await getDashboard({ user: { role: 'Staff' } }, result)

    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body.data.summary, { today_transactions: 3, outstanding_credits: '50.00' })
    assert.equal(result.body.data.recent_transactions[0].reference_id, 6)
    assert.equal(Object.hasOwn(result.body.data.recent_transactions[0], 'amount'), false)
    assert.deepEqual(result.body.data.today_quantity_by_unit, [{ unit: 'kg', total_quantity: '2.000' }])
    assert.equal(result.body.data.low_stock_alerts[0].product_id, 2)
    assert.equal(result.body.data.recent_stock_in[0].stockin_id, 9)
    assert.equal('trends' in result.body.data, false)
    assert.equal(queries.length, 5)
    assert.ok(queries.every((sql) => !sql.includes('activity_logs')))
  } finally {
    pool.execute = original
  }
})

test('staff sales activity returns seven Manila calendar days with zero-filled distinct transaction counts', async () => {
  const original = pool.execute
  let queryText = ''
  let queryParams = []
  pool.execute = async (sql, params) => {
    queryText = sql
    queryParams = params
    const secondDay = new Date(`${params[0]}T00:00:00.000Z`)
    secondDay.setUTCDate(secondDay.getUTCDate() + 1)
    return [[
      { sale_day: params[0], transaction_count: 2 },
      { sale_day: secondDay.toISOString().slice(0, 10), transaction_count: 1 },
    ]]
  }

  try {
    const result = response()
    await getStaffSalesActivity({ user: { role: 'Staff' } }, result)

    assert.equal(result.statusCode, 200)
    assert.match(queryText, /COUNT\(DISTINCT sale_id\)/)
    assert.doesNotMatch(queryText, /total_amount|amount_paid|profit|revenue/i)
    assert.equal(queryParams.length, 2)
    const days = result.body.data.days
    const expectedSecondDay = new Date(`${queryParams[0]}T00:00:00.000Z`)
    expectedSecondDay.setUTCDate(expectedSecondDay.getUTCDate() + 1)
    assert.equal(days.length, 7)
    assert.equal(days[0].date, queryParams[0])
    assert.equal(days[0].transactions, 2)
    assert.equal(days[1].date, expectedSecondDay.toISOString().slice(0, 10))
    assert.equal(days[1].transactions, 1)
    assert.deepEqual(days.slice(2).map((day) => day.transactions), [0, 0, 0, 0, 0])
    assert.equal(days[6].date, new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()))
  } finally {
    pool.execute = original
  }
})
