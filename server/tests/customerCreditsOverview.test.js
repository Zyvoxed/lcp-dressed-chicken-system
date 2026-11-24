import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { getCustomerCashSales, getCustomerPayments, getCustomerSales, getCustomers } from '../controllers/customerController.js'
import { authorizeCapability } from '../middleware/authorizeRoles.js'

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

test('customer cash payment history is scoped and restricted to fully settled cash sales', async () => {
  const response = responseRecorder()
  let query = ''
  let parameters

  await withExecute(async (sql, values) => {
    query = sql
    parameters = values
    return [[{
      sale_id: 23,
      sale_date: '2026-11-03T12:00:00+08:00',
      amount_paid: '1250.00',
      payment_type: 'Cash',
      status: 'Paid',
    }]]
  }, () => getCustomerCashSales({ params: { id: '7' } }, response))

  assert.equal(response.statusCode, 200)
  assert.deepEqual(parameters, [7])
  assert.match(query, /WHERE customer_id = \?/)
  assert.match(query, /payment_type = 'Cash'/)
  assert.match(query, /status = 'Paid'/)
  assert.match(query, /remaining_balance = 0/)
  assert.match(query, /amount_paid = total_amount/)
  assert.deepEqual(Object.keys(response.payload.data[0]), [
    'sale_id', 'sale_date', 'amount_paid', 'payment_type', 'status',
  ])
})

test('customer cash sales rejects malformed customer IDs before querying', async () => {
  const response = responseRecorder()

  await withExecute(async () => {
    throw new Error('Database should not be queried')
  }, () => getCustomerCashSales({ params: { id: '7x' } }, response))

  assert.equal(response.statusCode, 400)
  assert.equal(response.payload.message, 'Invalid customer ID')
})

test('customer payment history only returns payments linked to that customer credit sale', async () => {
  const response = responseRecorder()
  let query = ''
  let parameters

  await withExecute(async (sql, values) => {
    query = sql
    parameters = values
    return [[{ payment_id: 5, sale_id: 12, payment_amount: '50.00' }]]
  }, () => getCustomerPayments({ params: { id: '7' } }, response))

  assert.equal(response.statusCode, 200)
  assert.deepEqual(parameters, [7])
  assert.match(query, /JOIN sales sa ON sa\.sale_id = pa\.sale_id/)
  assert.match(query, /sa\.customer_id = pa\.customer_id/)
  assert.match(query, /sa\.payment_type = 'Credit'/)
  assert.match(query, /WHERE pa\.customer_id = \? /)
})

test('customer payment read capability allows Admin and Staff but rejects anonymous requests', () => {
  const authorize = authorizeCapability('customer.payment.read')
  const run = (user) => {
    const response = responseRecorder()
    let nextCalled = false
    authorize({ user }, response, () => { nextCalled = true })
    return { response, nextCalled }
  }

  assert.equal(run({ role: 'Admin' }).nextCalled, true)
  assert.equal(run({ role: 'Staff' }).nextCalled, true)
  const anonymous = run(null)
  assert.equal(anonymous.nextCalled, false)
  assert.equal(anonymous.response.statusCode, 403)
})
