import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getSalesReportDetail } from '../controllers/reportController.js'

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('sales report detail returns cumulative paid amount and only subsequent records for the requested sale', async () => {
  const original = pool.execute
  const queries = []
  pool.execute = async (sql, parameters) => {
    queries.push({ sql, parameters })
    if (sql.includes('sa.sale_id')) return [[{
      sale_id: 84,
      sale_date: '2026-11-20T00:37:22+08:00',
      recorded_by: 'LCP Admin',
      payment_type: 'Credit',
      total_amount: '27060.00',
      amount_paid: '7060.00',
      remaining_balance: '20000.00',
      status: 'Partially Paid',
    }]]
    if (sql.includes('FROM sales_items')) return [[]]
    if (sql.includes('FROM payments pa')) return [[{
      payment_id: 23,
      payment_amount: '7000.00',
      remaining_balance: '20000.00',
      payment_date: '2026-11-20T02:09:28+08:00',
      recorded_by: 'LCP Admin',
    }]]
    assert.fail(`Unexpected report detail query: ${sql}`)
  }

  try {
    const result = response()
    await getSalesReportDetail({ params: { id: '84' } }, result)

    assert.equal(result.statusCode, 200)
    assert.equal(result.body.data.sale.amount_paid, '7060.00')
    assert.equal(result.body.data.sale.total_amount, '27060.00')
    assert.equal(result.body.data.sale.sale_date, '2026-11-20T00:37:22+08:00')
    assert.equal(result.body.data.sale.recorded_by, 'LCP Admin')
    assert.deepEqual(result.body.data.payments.map(({ payment_id, payment_amount }) => [payment_id, payment_amount]), [
      [23, '7000.00'],
    ])
    assert.deepEqual(queries.map(({ parameters }) => parameters), [[84], [84], [84]])
    assert.match(queries[2].sql, /WHERE pa.sale_id = ?/)
    assert.match(queries[2].sql, /ORDER BY pa.payment_date ASC, pa.payment_id ASC/)
  } finally {
    pool.execute = original
  }
})
