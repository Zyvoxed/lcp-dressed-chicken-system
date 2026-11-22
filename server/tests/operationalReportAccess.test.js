import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getOperationalReport } from '../controllers/operationalReportController.js'

function recorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(value) { this.payload = value; return this },
  }
}

test('operational inventory report returns active quantity/status fields without valuation fields', async () => {
  const originalExecute = pool.execute
  pool.execute = async (sql) => {
    if (sql.includes('COUNT(*) AS total_records')) return [[{ total_records: 1 }]]
    if (sql.includes('COUNT(*) AS active_products')) return [[{ active_products: 1, low_stock_products: 0, out_of_stock_products: 0 }]]
    if (sql.includes('SELECT unit, SUM(stock_quantity)')) return [[{ unit: 'kg', total_quantity: '4.000' }]]
    if (sql.includes('SELECT product_id, product_name, category, unit, stock_quantity')) {
      return [[{ product_id: 1, product_name: 'Whole Chicken', category: 'Poultry', unit: 'kg', stock_quantity: '4.000', reorder_level: '1.000', status: 'Available' }]]
    }
    assert.fail(`Unexpected report query: ${sql}`)
  }
  try {
    const response = recorder()
    await getOperationalReport({ params: { report: 'inventory' }, query: { page: '1', page_size: '25', search: '' } }, response)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.payload.data.records[0], {
      product_id: 1, product_name: 'Whole Chicken', category: 'Poultry', unit: 'kg',
      stock_quantity: '4.000', reorder_level: '1.000', status: 'Available',
    })
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'selling_price'), false)
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'cost_price'), false)
  } finally { pool.execute = originalExecute }
})

test('operational sales report searches products, applies filters, and returns unit-separated quantities without monetary totals', async () => {
  const originalExecute = pool.execute
  const statements = []
  pool.execute = async (sql, parameters) => {
    statements.push({ sql, parameters })
    if (sql.includes('COUNT(*) AS total_records FROM sales')) return [[{ total_records: 1 }]]
    if (sql.includes('SELECT sa.sale_id')) return [[{ sale_id: 8, sale_date: '2026-11-22T10:00:00+08:00', customer_name: 'Customer', payment_type: 'Cash', status: 'Paid', item_count: 2 }]]
    if (sql.includes('COUNT(*) AS transaction_count')) return [[{ transaction_count: 1 }]]
    if (sql.includes('SELECT p.unit, COALESCE(SUM(si.quantity)')) return [[{ unit: 'kg', total_quantity: '2.000' }, { unit: 'piece', total_quantity: '3.000' }]]
    if (sql.includes('SELECT si.sale_id, p.unit, SUM(si.quantity)')) return [[{ sale_id: 8, unit: 'kg', total_quantity: '2.000' }, { sale_id: 8, unit: 'piece', total_quantity: '3.000' }]]
    if (sql.includes('SELECT si.sale_id, p.product_name')) return [[{ sale_id: 8, product_name: 'Whole Chicken', unit: 'kg', quantity_sold: '2.000' }, { sale_id: 8, product_name: 'Feet', unit: 'piece', quantity_sold: '3.000' }]]
    assert.fail(`Unexpected report query: ${sql}`)
  }
  try {
    const response = recorder()
    await getOperationalReport({
      params: { report: 'sales' },
      query: { start_date: '2026-11-01', end_date: '2026-11-22', payment_type: 'Cash', status: 'Paid', search: 'Chicken', page: '1', page_size: '10' },
    }, response)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.payload.data.summary.quantity_by_unit, [
      { unit: 'kg', total_quantity: '2.000' }, { unit: 'piece', total_quantity: '3.000' },
    ])
    assert.deepEqual(response.payload.data.records[0].quantity_by_unit, [
      { unit: 'kg', total_quantity: '2.000' }, { unit: 'piece', total_quantity: '3.000' },
    ])
    assert.deepEqual(response.payload.data.records[0].products_sold, [
      { product_name: 'Whole Chicken', unit: 'kg', quantity_sold: '2.000' },
      { product_name: 'Feet', unit: 'piece', quantity_sold: '3.000' },
    ])
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'total_amount'), false)
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'sales_amount'), false)
    assert.ok(statements[1].sql.includes('DATE_ADD(?, INTERVAL 1 DAY)'))
    assert.ok(statements[1].sql.includes('EXISTS (SELECT 1 FROM sales_items search_items'))
    assert.deepEqual(statements[1].parameters.slice(0, 4), ['2026-11-01 00:00:00', '2026-11-22 00:00:00', 'Cash', 'Paid'])
    assert.deepEqual(statements[1].parameters.slice(4, 8), Array(4).fill('%Chicken%'))
  } finally { pool.execute = originalExecute }
})

test('operational stock-in projection omits procurement cost fields', async () => {
  const originalExecute = pool.execute
  const statements = []
  pool.execute = async (sql) => {
    statements.push(sql)
    if (sql.includes('COUNT(*) AS total_records')) return [[{ total_records: 1 }]]
    if (sql.includes('SELECT si.stockin_id')) return [[{ stockin_id: 4, supplier_name: 'Supplier', product_name: 'Chicken', unit: 'kg', quantity_received: '5.000', delivery_date: '2026-11-22T10:00:00+08:00' }]]
    assert.fail(`Unexpected report query: ${sql}`)
  }
  try {
    const response = recorder()
    await getOperationalReport({ params: { report: 'stock-in' }, query: {} }, response)
    assert.equal(response.statusCode, 200)
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'cost_price'), false)
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'total_cost'), false)
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'remaining_quantity'), false)
    assert.equal(Object.hasOwn(response.payload.data.records[0], 'recorded_by'), false)
    const rowQuery = statements.find((sql) => sql.includes('SELECT si.stockin_id'))
    assert.ok(!rowQuery.includes('cost_price'))
    assert.ok(!rowQuery.includes('total_cost'))
    assert.ok(!rowQuery.includes('remaining_quantity'))
    assert.ok(!rowQuery.includes('recorded_by'))
  } finally { pool.execute = originalExecute }
})

test('operational reports reject malformed dates and pagination before querying', async () => {
  const originalExecute = pool.execute
  pool.execute = async () => assert.fail('Invalid report query must be rejected before database access')
  try {
    const invalidDate = recorder()
    await getOperationalReport({ params: { report: 'sales' }, query: { start_date: '2026-02-30' } }, invalidDate)
    assert.equal(invalidDate.statusCode, 400)
    const invalidPage = recorder()
    await getOperationalReport({ params: { report: 'inventory' }, query: { page: '0' } }, invalidPage)
    assert.equal(invalidPage.statusCode, 400)
  } finally { pool.execute = originalExecute }
})
