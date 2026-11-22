import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getProductSalesReport, getReceivablesReport, getSalesReport } from '../controllers/reportController.js'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('sales report preserves filters, summaries, counts, and payment aggregation on a later page', async () => {
  const original = pool.execute
  const calls = []
  pool.execute = async (sql, values) => {
    calls.push({ sql, values })
    if (sql.includes('payment_totals')) return [[{ sale_id: 3, later_payments_total: '5.00' }]]
    if (sql.includes('total_transactions')) return [[{ total_transactions: 250, gross_sales: '500.00' }]]
    if (sql.includes('COUNT(*) AS total_records')) return [[{ total_records: 250 }]]
    throw new Error(`Unexpected report query ${sql}`)
  }
  try {
    const result = response()
    await getSalesReport({ query: {
      start_date: '2026-01-01', payment_type: 'Credit', status: 'Partially Paid',
      end_date: '2026-01-31', search: 'chicken', page: '2', page_size: '100',
    } }, result)
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.data.pagination.page, 2)
    assert.equal(result.body.data.pagination.total_pages, 3)
    assert.equal(result.body.data.summary.total_transactions, 250)
    assert.equal(result.body.data.summary.gross_sales, '500.00')
    assert.equal(result.body.data.pagination.total_records, 250)
    assert.equal(calls.length, 3)
    assert.match(calls[0].sql, /LIMIT \? OFFSET \?/)
    assert.match(calls[0].sql, /GROUP BY sale_id/)
    assert.deepEqual(calls[0].values.slice(-2), ['100', '100'])
    assert.ok(calls[0].values.includes('%chicken%'))
    assert.ok(calls[0].values.includes('2026-01-31 00:00:00'))
    assert.match(calls[1].sql, /sa\.status = \?/)
    assert.match(calls[1].sql, /c\.customer_name LIKE \?/)
    assert.ok(calls[1].values.includes('Partially Paid'))
    assert.equal(calls[1].values.filter((value) => value === '%chicken%').length, 6)
    assert.equal(result.body.data.records[0].later_payments_total, '5.00')
  } finally { pool.execute = original }
})

test('sales report returns an empty first page and zero summaries with string pagination binds', async () => {
  const original = pool.execute
  const calls = []
  pool.execute = async (sql, values) => {
    calls.push({ sql, values })
    if (sql.includes('payment_totals')) return [[]]
    if (sql.includes('total_transactions')) return [[{ total_transactions: 0, gross_sales: '0.00' }]]
    if (sql.includes('COUNT(*) AS total_records')) return [[{ total_records: 0 }]]
    throw new Error(`Unexpected report query ${sql}`)
  }
  try {
    const result = response()
    await getSalesReport({ query: { page: '1', page_size: '25' } }, result)
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body.data.records, [])
    assert.equal(result.body.data.summary.total_transactions, 0)
    assert.equal(result.body.data.pagination.total_pages, 0)
    assert.deepEqual(calls[0].values, ['25', '0'])
  } finally { pool.execute = original }
})

test('invalid sales report pagination is rejected before querying the database', async () => {
  const original = pool.execute
  pool.execute = async () => assert.fail('Invalid page size must not query the database')
  try {
    const result = response()
    await getSalesReport({ query: { page: '1', page_size: '1000' } }, result)
    assert.equal(result.statusCode, 400)
  } finally { pool.execute = original }
})

test('sales pagination returns consistent first, last, and empty pages with stable totals', async () => {
  const original = pool.execute
  const rows = [
    { sale_id: 4, status: 'Paid' },
    { sale_id: 3, status: 'Paid' },
    { sale_id: 2, status: 'Paid' },
    { sale_id: 1, status: 'Unpaid' },
  ]
  pool.execute = async (sql, values = []) => {
    if (sql.includes('payment_totals')) {
      const status = sql.includes('sa.status = ?') ? values[0] : null
      const matchingRows = status ? rows.filter((row) => row.status === status) : rows
      const pageSize = Number(values.at(-2))
      const offset = Number(values.at(-1))
      return [matchingRows.slice(offset, offset + pageSize)]
    }
    if (sql.includes('total_transactions')) {
      return [[{ total_transactions: 3, gross_sales: '90.00' }]]
    }
    if (sql.includes('COUNT(*) AS total_records')) return [[{ total_records: 3 }]]
    throw new Error(`Unexpected report query ${sql}`)
  }
  try {
    for (const [page, expectedIds] of [[1, [4, 3]], [2, [2]], [3, []]]) {
      const result = response()
      await getSalesReport({ query: { status: 'Paid', page: String(page), page_size: '2' } }, result)
      assert.equal(result.statusCode, 200)
      assert.deepEqual(result.body.data.records.map((row) => row.sale_id), expectedIds)
      assert.deepEqual(result.body.data.pagination, {
        page, page_size: 2, total_records: 3, total_pages: 2,
      })
      assert.equal(result.body.data.summary.total_transactions, 3)
      assert.equal(result.body.data.summary.gross_sales, '90.00')
    }
  } finally { pool.execute = original }
})

test('sales pagination rejects malformed page and page-size values', async () => {
  const original = pool.execute
  pool.execute = async () => assert.fail('Invalid pagination must not query the database')
  try {
    for (const query of [
      { page: '-1' }, { page: '1.2' }, { page: '9007199254740992' },
      { page_size: '0' }, { page_size: '-5' }, { page_size: '101' }, { page_size: '2.5' },
    ]) {
      const result = response()
      await getSalesReport({ query }, result)
      assert.equal(result.statusCode, 400, JSON.stringify(query))
    }
  } finally { pool.execute = original }
})

test('receivables search paginates later pages and retains all-customer outstanding totals', async () => {
  const original = pool.execute
  const calls = []
  pool.execute = async (sql, values) => {
    calls.push({ sql, values })
    if (sql.includes('COUNT(*) AS total_records')) return [[{ total_records: 301 }]]
    if (sql.includes('GROUP BY c.customer_id')) return [[{ customer_id: 8, current_balance: '20.00', open_credit_sales: 2 }]]
    if (sql.includes('customers_with_balance')) return [[{ customers_with_balance: 31, total_receivables: '800.00' }]]
    throw new Error(`Unexpected report query ${sql}`)
  }
  try {
    const result = response()
    await getReceivablesReport({ query: { page: '2', page_size: '25', search: 'Mia' } }, result)
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.data.pagination.total_records, 301)
    assert.equal(result.body.data.pagination.total_pages, 13)
    assert.deepEqual(calls[0].values, ['%Mia%', '%Mia%', '%Mia%'])
    assert.deepEqual(calls[1].values, ['%Mia%', '%Mia%', '%Mia%', '25', '25'])
    assert.match(calls[1].sql, /c\.customer_name LIKE/)
    assert.equal(result.body.data.records[0].current_balance, '20.00')
    assert.equal(result.body.data.records[0].open_credit_sales, 2)
    assert.equal(result.body.data.summary.total_receivables, '800.00')
    assert.doesNotMatch(calls[2].sql, /LIMIT/)
  } finally { pool.execute = original }
})

test('receivables report returns no matching customers on the first page with zero summary totals', async () => {
  const original = pool.execute
  const calls = []
  pool.execute = async (sql, values) => {
    calls.push({ sql, values })
    if (sql.includes('COUNT(*) AS total_records')) return [[{ total_records: 0 }]]
    if (sql.includes('GROUP BY c.customer_id')) return [[]]
    if (sql.includes('customers_with_balance')) return [[{ customers_with_balance: 0, total_receivables: '0.00' }]]
    throw new Error(`Unexpected report query ${sql}`)
  }
  try {
    const result = response()
    await getReceivablesReport({ query: { page: '1', page_size: '25', search: 'No Match' } }, result)
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body.data.records, [])
    assert.equal(result.body.data.summary.total_receivables, '0.00')
    assert.equal(result.body.data.pagination.total_records, 0)
    assert.deepEqual(calls[1].values, ['%No Match%', '%No Match%', '%No Match%', '25', '0'])
  } finally { pool.execute = original }
})

test('product sales analytics return one batched monthly aggregate query', async () => {
  const original = pool.execute
  let query
  pool.execute = async (sql, values) => {
    query = { sql, values }
    return [[{ product_id: 5, sale_year: 2026, sale_month: 11, quantity_sold: '3.000', sales_amount: '750.00' }]]
  }
  try {
    const result = response()
    await getProductSalesReport({ query: { product_ids: '5,6', year: '2026' } }, result)
    assert.equal(result.statusCode, 200)
    assert.match(query.sql, /SUM\(si\.quantity\)/)
    assert.match(query.sql, /GROUP BY si\.product_id.*YEAR\(sa\.sale_date\)/s)
    assert.deepEqual(query.values, [5, 6, 2026])
  } finally { pool.execute = original }
})
