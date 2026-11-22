import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getBusinessAnalytics } from '../controllers/dashboardController.js'
import {
  getInventoryReport,
  getProductSalesReport,
  getSalesReport,
} from '../controllers/reportController.js'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

const sales = [
  { sale_id: 1, sale_date: '2026-03-01 00:00:00', payment_type: 'Cash', status: 'Paid', total_amount: '10.10', amount_paid: '10.10', remaining_balance: '0.00', user_id: 2, customer_name: 'Ada Market', recorded_by: 'Nina Admin' },
  { sale_id: 2, sale_date: '2026-03-31 23:59:59', payment_type: 'Credit', status: 'Partially Paid', total_amount: '20.20', amount_paid: '5.00', remaining_balance: '15.20', user_id: 3, customer_name: 'Ben Shop', recorded_by: 'Omar Staff' },
  { sale_id: 3, sale_date: '2026-04-01 00:00:00', payment_type: 'Credit', status: 'Unpaid', total_amount: '30.30', amount_paid: '0.00', remaining_balance: '30.30', user_id: 3, customer_name: 'Ada Market', recorded_by: 'Omar Staff' },
  { sale_id: 4, sale_date: '2026-03-15 12:00:00', payment_type: 'Cash', status: 'Paid', total_amount: '4.40', amount_paid: '4.40', remaining_balance: '0.00', user_id: 3, customer_name: 'Cara Shop', recorded_by: 'Omar Staff' },
]

function filterSales(sql, parameters, includeInteractive) {
  let parameterIndex = 0
  const predicates = []
  if (sql.includes('sa.sale_date >= ?')) {
    const start = parameters[parameterIndex++]
    predicates.push((sale) => sale.sale_date >= start)
  }
  if (sql.includes('sa.sale_date < DATE_ADD(?, INTERVAL 1 DAY)')) {
    const end = new Date(`${parameters[parameterIndex++].slice(0, 10)}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    const endExclusive = `${end.toISOString().slice(0, 10)} 00:00:00`
    predicates.push((sale) => sale.sale_date < endExclusive)
  }
  if (sql.includes('sa.payment_type = ?')) {
    const type = parameters[parameterIndex++]
    predicates.push((sale) => sale.payment_type === type)
  }
  if (sql.includes('sa.user_id = ?')) {
    const userId = Number(parameters[parameterIndex++])
    predicates.push((sale) => sale.user_id === userId)
  }
  if (includeInteractive && sql.includes('sa.status = ?')) {
    const status = parameters[parameterIndex++]
    predicates.push((sale) => sale.status === status)
  }
  if (includeInteractive && sql.includes('CAST(sa.sale_id AS CHAR) LIKE ?')) {
    const term = parameters[parameterIndex].slice(1, -1).toLowerCase()
    predicates.push((sale) => [String(sale.sale_id), `OR-${sale.sale_id}`, sale.customer_name, sale.recorded_by, sale.payment_type, sale.status]
      .some((value) => value.toLowerCase().includes(term)))
  }
  return sales.filter((sale) => predicates.every((predicate) => predicate(sale)))
}

function cents(value) { return Math.round(Number(value) * 100) }

function sumSales(records) {
  const total = (list, key) => (list.reduce((sum, row) => sum + cents(row[key]), 0) / 100).toFixed(2)
  return {
    total_transactions: records.length,
    gross_sales: total(records, 'total_amount'),
    cash_sales_total: total(records.filter((row) => row.payment_type === 'Cash'), 'total_amount'),
    credit_sales_total: total(records.filter((row) => row.payment_type === 'Credit'), 'total_amount'),
    total_amount_paid: total(records, 'amount_paid'),
    outstanding_balance: total(records, 'remaining_balance'),
  }
}

function installSalesReportFake() {
  const original = pool.execute
  pool.execute = async (sql, parameters = []) => {
    if (sql.includes('payment_totals')) {
      const filtered = filterSales(sql, parameters.slice(0, -2), true)
        .sort((left, right) => right.sale_date.localeCompare(left.sale_date) || right.sale_id - left.sale_id)
      const pageSize = Number(parameters.at(-2))
      const offset = Number(parameters.at(-1))
      return [filtered.slice(offset, offset + pageSize).map((sale) => ({ ...sale, later_payments_total: '0.00' }))]
    }
    if (sql.includes('total_transactions')) {
      return [[sumSales(filterSales(sql, parameters, true))]]
    }
    if (sql.includes('COUNT(*) AS total_records')) {
      return [[{ total_records: filterSales(sql, parameters, true).length }]]
    }
    throw new Error(`Unexpected sales report query: ${sql}`)
  }
  return () => { pool.execute = original }
}

test('sales date range includes both calendar-day boundaries and returns filtered rows and summary', async () => {
  const restore = installSalesReportFake()
  try {
    const result = response()
    await getSalesReport({ query: {
      start_date: '2026-03-01', end_date: '2026-03-31',
      status: 'Paid', search: 'Ada', page: '1', page_size: '10',
    } }, result)
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body.data.records.map((row) => row.sale_id), [1])
    assert.equal(result.body.data.records[0].sale_date, sales[0].sale_date)
    // Date bounds apply through 23:59:59 on the end date; April 1 midnight is excluded.
    assert.deepEqual(filterSales('sa.sale_date >= ? AND sa.sale_date < DATE_ADD(?, INTERVAL 1 DAY)', [
      '2026-03-01 00:00:00', '2026-03-31 00:00:00',
    ], false).map((sale) => sale.sale_id), [1, 2, 4])
    // Summary, rows, and count all describe the same filtered result set.
    assert.deepEqual(result.body.data.summary, {
      total_transactions: 1,
      gross_sales: '10.10',
      cash_sales_total: '10.10',
      credit_sales_total: '0.00',
      total_amount_paid: '10.10',
      outstanding_balance: '0.00',
    })
    assert.deepEqual(result.body.data.pagination, {
      page: 1, page_size: 10, total_records: 1, total_pages: 1,
    })
  } finally { restore() }
})

test('sales payment-type and user filters constrain records and summary values', async () => {
  const restore = installSalesReportFake()
  try {
    const result = response()
    await getSalesReport({ query: { payment_type: 'Credit', user_id: '3' } }, result)
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body.data.records.map((row) => row.sale_id), [3, 2])
    assert.equal(result.body.data.summary.gross_sales, '50.50')
    assert.equal(result.body.data.summary.credit_sales_total, '50.50')
    assert.equal(result.body.data.pagination.total_records, 2)
  } finally { restore() }
})

test('unfiltered sales report summary matches the complete dataset independently of page size', async () => {
  const restore = installSalesReportFake()
  try {
    const result = response()
    await getSalesReport({ query: { page: '1', page_size: '2' } }, result)
    assert.deepEqual(result.body.data.records.map((row) => row.sale_id), [3, 2])
    assert.equal(result.body.data.pagination.total_records, 4)
    assert.equal(result.body.data.summary.total_transactions, 4)
    assert.equal(result.body.data.summary.gross_sales, '65.00')
    assert.equal(result.body.data.summary.cash_sales_total, '14.50')
    assert.equal(result.body.data.summary.credit_sales_total, '50.50')
    assert.equal(result.body.data.summary.total_amount_paid, '19.50')
    assert.equal(result.body.data.summary.outstanding_balance, '45.50')
  } finally { restore() }
})

test('status, text search, and combined filters produce matching summary totals', async () => {
  const restore = installSalesReportFake()
  try {
    const cases = [
      { query: { status: 'Paid' }, ids: [4, 1], gross: '14.50' },
      { query: { search: 'Ada' }, ids: [3, 1], gross: '40.40' },
      { query: { status: 'Paid', search: 'Ada' }, ids: [1], gross: '10.10' },
      { query: { start_date: '2026-03-01', end_date: '2026-03-31', payment_type: 'Credit', status: 'Partially Paid' }, ids: [2], gross: '20.20' },
      { query: { user_id: '3', search: 'Ben' }, ids: [2], gross: '20.20' },
      { query: { status: 'Unpaid', search: 'No Match' }, ids: [], gross: '0.00' },
    ]

    for (const scenario of cases) {
      const result = response()
      await getSalesReport({ query: scenario.query }, result)
      const { records, summary, pagination: page } = result.body.data
      assert.equal(result.statusCode, 200)
      assert.deepEqual(records.map((row) => row.sale_id), scenario.ids, JSON.stringify(scenario.query))
      assert.equal(summary.total_transactions, scenario.ids.length, JSON.stringify(scenario.query))
      assert.equal(summary.gross_sales, scenario.gross, JSON.stringify(scenario.query))
      assert.equal(page.total_records, scenario.ids.length, JSON.stringify(scenario.query))
      assert.equal(page.total_pages, scenario.ids.length ? 1 : 0, JSON.stringify(scenario.query))
    }
  } finally { restore() }
})

test('sales report validates malformed dates, reversed ranges, status, user, and pagination before queries', async () => {
  const original = pool.execute
  pool.execute = async () => assert.fail('Invalid report filters must not query the database')
  try {
    for (const query of [
      { start_date: '2026-02-30' },
      { start_date: '2026-04-01', end_date: '2026-03-31' },
      { status: 'Pending' },
      { user_id: '0' },
      { page: '0' },
      { page: '1.5' },
      { page_size: '101' },
      { page_size: '0' },
    ]) {
      const result = response()
      await getSalesReport({ query }, result)
      assert.equal(result.statusCode, 400, JSON.stringify(query))
    }
  } finally { pool.execute = original }
})

test('product sales applies selected product IDs and year and groups sales by month', async () => {
  const original = pool.execute
  const items = [
    { product_id: 5, sale_date: '2025-12-31 23:59:59', quantity: '1.250', subtotal: '12.50' },
    { product_id: 5, sale_date: '2026-01-01 00:00:00', quantity: '2.000', subtotal: '20.00' },
    { product_id: 5, sale_date: '2026-01-20 10:00:00', quantity: '0.500', subtotal: '5.00' },
    { product_id: 6, sale_date: '2026-01-21 10:00:00', quantity: '1.000', subtotal: '8.00' },
  ]
  pool.execute = async (sql, parameters = []) => {
    const ids = parameters.slice(0, -1)
    const year = Number(parameters.at(-1))
    assert.match(sql, /SUM\(si\.quantity\)/)
    assert.match(sql, /SUM\(si\.subtotal\)/)
    assert.match(sql, /GROUP BY si\.product_id, p\.product_name, YEAR\(sa\.sale_date\), MONTH\(sa\.sale_date\)/)
    const grouped = new Map()
    for (const item of items.filter((row) => ids.includes(row.product_id) && Number(row.sale_date.slice(0, 4)) === year)) {
      const month = Number(item.sale_date.slice(5, 7))
      const key = `${item.product_id}:${month}`
      const aggregate = grouped.get(key) || { product_id: item.product_id, product_name: `Product ${item.product_id}`, sale_year: year, sale_month: month, quantity_sold: 0, sales_amount_cents: 0 }
      aggregate.quantity_sold += Number(item.quantity)
      aggregate.sales_amount_cents += cents(item.subtotal)
      grouped.set(key, aggregate)
    }
    return [[...grouped.values()].map(({ sales_amount_cents, ...row }) => ({ ...row, sales_amount: (sales_amount_cents / 100).toFixed(2) }))]
  }
  try {
    const result = response()
    await getProductSalesReport({ query: { product_ids: '5,6', year: '2026' } }, result)
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body.data.records, [
      { product_id: 5, product_name: 'Product 5', sale_year: 2026, sale_month: 1, quantity_sold: 2.5, sales_amount: '25.00' },
      { product_id: 6, product_name: 'Product 6', sale_year: 2026, sale_month: 1, quantity_sold: 1, sales_amount: '8.00' },
    ])
  } finally { pool.execute = original }
})

test('product sales rejects missing, malformed, excessive, and out-of-range selections', async () => {
  const original = pool.execute
  pool.execute = async () => assert.fail('Invalid product selections must not query the database')
  try {
    for (const query of [
      {},
      { product_ids: '1,nope' },
      { product_ids: '0' },
      { product_ids: Array.from({ length: 51 }, (_, index) => index + 1).join(',') },
      { product_ids: '1', year: '999' },
      { product_ids: '1', year: '10000' },
    ]) {
      const result = response()
      await getProductSalesReport({ query }, result)
      assert.equal(result.statusCode, 400, JSON.stringify(query))
    }
  } finally { pool.execute = original }
})

test('inventory report exposes existing stock-cost and estimated-sales valuation outputs', async () => {
  const original = pool.execute
  pool.execute = async (sql) => {
    if (sql.includes('SELECT p.product_id, p.product_name')) {
      return [[{
        product_id: 4, product_name: 'Chicken', stock_quantity: '3.000', selling_price: '20.00',
        inventory_cost_value: '37.50', estimated_sales_value: '60.00', status: 'Available',
      }]]
    }
    if (sql.includes('total_inventory_cost_value')) {
      return [[{
        total_products: 1, total_inventory_cost_value: '37.50', estimated_total_sales_value: '60.00',
        low_stock_count: 0, out_of_stock_count: 0,
      }]]
    }
    if (sql.includes('SUM(stock_quantity) AS total_quantity')) return [[{ unit: 'kg', total_quantity: '3.000' }]]
    throw new Error(`Unexpected report query: ${sql}`)
  }
  try {
    const result = response()
    await getInventoryReport({}, result)
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.data.records[0].inventory_cost_value, '37.50')
    assert.equal(result.body.data.records[0].estimated_sales_value, '60.00')
    assert.equal(result.body.data.summary.total_inventory_cost_value, '37.50')
    assert.deepEqual(result.body.data.summary.quantity_by_unit, [{ unit: 'kg', total_quantity: '3.000' }])
  } finally { pool.execute = original }
})

test('business analytics ranks performers, slow sellers, and restock alerts from report rows', async () => {
  const original = pool.execute
  const products = [
    { product_id: 1, product_name: 'Fast', unit: 'kg', current_stock: '1.000', reorder_level: '5.000', quantity_sold: '10.000', gross_sales: '100.00' },
    { product_id: 2, product_name: 'Slow', unit: 'kg', current_stock: '0.000', reorder_level: '2.000', quantity_sold: '0.000', gross_sales: '0.00' },
    { product_id: 3, product_name: 'Steady', unit: 'kg', current_stock: '8.000', reorder_level: '4.000', quantity_sold: '5.000', gross_sales: '70.00' },
  ]
  pool.execute = async (sql) => {
    if (sql.includes('average_ticket_value')) {
      return [[{ total_transactions: 3, gross_revenue: '170.00', average_ticket_value: '56.67' }]]
    }
    if (sql.includes('AS current_stock')) return [products]
    throw new Error(`Unexpected dashboard query: ${sql}`)
  }
  try {
    const result = response()
    await getBusinessAnalytics({}, result)
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.data.summary.gross_revenue, '170.00')
    assert.deepEqual(result.body.data.top_performing.map((product) => product.product_name), ['Fast', 'Steady'])
    assert.deepEqual(result.body.data.slow_selling.map((product) => product.product_name), ['Slow', 'Steady', 'Fast'])
    assert.deepEqual(result.body.data.restock_alerts.map((product) => product.product_name), ['Slow', 'Fast'])
    assert.equal(result.body.data.insights.procurement_priority.product_name, 'Slow')
  } finally { pool.execute = original }
})
