import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getCustomerSales, getCustomers } from '../controllers/customerController.js'

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

async function withExecute(execute, callback) {
  const original = pool.execute
  pool.execute = execute
  try {
    await callback()
  } finally {
    pool.execute = original
  }
}

test('customer overview retains the canonical balance and aggregates credit and payment data once per customer', async () => {
  const response = responseRecorder()
  let query = ''

  await withExecute(async (sql) => {
    query = sql
    return [[{
      customer_id: 7,
      current_balance: '300.00',
      total_credit: '500.00',
      total_paid: '200.00',
      last_payment_at: '2026-11-12T08:00:00+08:00',
    }]]
  }, () => getCustomers({}, response))

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.data.length, 1)
  assert.equal(response.payload.data[0].current_balance, '300.00')
  assert.match(query, /SUM\(total_amount\) AS total_credit/)
  assert.match(query, /SUM\(amount_paid\) AS total_paid/)
  assert.match(query, /WHERE payment_type = 'Credit'/)
  assert.match(query, /MAX\(payment_date\)/)
  assert.match(query, /WHERE c\.is_active = TRUE/)
})

test('customer sales history is scoped to the requested customer and includes cash and credit sales', async () => {
  const response = responseRecorder()
  let query = ''
  let parameters

  await withExecute(async (sql, values) => {
    query = sql
    parameters = values
    return [[
      { sale_id: 14, payment_type: 'Cash', item_count: 2 },
      { sale_id: 12, payment_type: 'Credit', item_count: 1 },
    ]]
  }, () => getCustomerSales({ params: { id: '7' } }, response))

  assert.equal(response.statusCode, 200)
  assert.deepEqual(parameters, [7])
  assert.match(query, /WHERE sa\.customer_id = \?/)
  assert.doesNotMatch(query, /payment_type\s*=\s*'Credit'/)
  assert.deepEqual(response.payload.data.map((sale) => sale.payment_type), ['Cash', 'Credit'])
})

test('customer sales rejects malformed IDs before querying the database', async () => {
  const response = responseRecorder()

  await withExecute(async () => {
    throw new Error('Database should not be queried')
  }, () => getCustomerSales({ params: { id: '7x' } }, response))

  assert.equal(response.statusCode, 400)
  assert.equal(response.payload.message, 'Invalid customer ID')
})
