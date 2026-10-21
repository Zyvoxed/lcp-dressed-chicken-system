import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import pool from '../config/database.js'
import { updateCustomer } from '../controllers/customerController.js'
import customerRoutes from '../routes/customerRoutes.js'

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function fakeCustomerConnection({ exists = true } = {}) {
  const customer = {
    customer_id: 7,
    customer_name: 'Maria Santos',
    contact_number: '09171234567',
    address: 'Quezon City',
    current_balance: '300.00',
    created_at: '2026-10-01T08:00:00+08:00',
  }
  const state = { began: false, committed: false, rolledBack: false, released: false, activity: null, updateSql: '' }
  return {
    customer,
    state,
    async beginTransaction() { state.began = true },
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    release() { state.released = true },
    async execute(sql, parameters) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT customer_id FROM customers')) {
        return [exists ? [{ customer_id: customer.customer_id }] : []]
      }
      if (normalized.startsWith('UPDATE customers SET')) {
        state.updateSql = normalized
        let index = 0
        if (normalized.includes('customer_name = ?')) customer.customer_name = parameters[index++]
        if (normalized.includes('contact_number = ?')) customer.contact_number = parameters[index++]
        if (normalized.includes('address = ?')) customer.address = parameters[index++]
        assert.equal(parameters[index], customer.customer_id)
        return [{ affectedRows: 1 }]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) {
        state.activity = { userId: parameters[0], description: parameters[1] }
        return [{ insertId: 80 }]
      }
      if (normalized.startsWith('SELECT customer_id, customer_name')) return [[{ ...customer }]]
      throw new Error(`Unexpected test query: ${normalized}`)
    },
  }
}

async function withFakeConnection(connection, callback) {
  const original = pool.getConnection
  pool.getConnection = async () => connection
  try { await callback() } finally { pool.getConnection = original }
}

test('valid customer updates change only contact fields and log the editor', async () => {
  const connection = fakeCustomerConnection()
  const response = responseRecorder()
  const salesBefore = [{ sale_id: 40, customer_id: 7, total_amount: '500.00' }]
  const paymentsBefore = [{ payment_id: 12, customer_id: 7, payment_amount: '200.00' }]

  await withFakeConnection(connection, () => updateCustomer({
    params: { id: '7' },
    body: { customer_name: '  Maria S. Santos  ', contact_number: ' 09990001111 ', address: '  Pasig City ' },
    user: { user_id: 2, role: 'Admin' },
  }, response))

  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.success, true)
  assert.deepEqual(response.payload.data, { ...connection.customer })
  assert.equal(connection.customer.customer_name, 'Maria S. Santos')
  assert.equal(connection.customer.contact_number, '09990001111')
  assert.equal(connection.customer.address, 'Pasig City')
  assert.equal(connection.customer.current_balance, '300.00')
  assert(!connection.state.updateSql.includes('current_balance'))
  assert.deepEqual(salesBefore, [{ sale_id: 40, customer_id: 7, total_amount: '500.00' }])
  assert.deepEqual(paymentsBefore, [{ payment_id: 12, customer_id: 7, payment_amount: '200.00' }])
  assert.deepEqual(connection.state.activity, { userId: 2, description: 'Customer 7 details updated' })
  assert.equal(connection.state.committed, true)
  assert.equal(connection.state.rolledBack, false)
  assert.equal(connection.state.released, true)
})

test('invalid IDs and unsupported financial fields are rejected before database access', async () => {
  const invalidIdResponse = responseRecorder()
  await updateCustomer({ params: { id: 'invalid' }, body: { customer_name: 'Name' }, user: { user_id: 2 } }, invalidIdResponse)
  assert.equal(invalidIdResponse.statusCode, 400)
  assert.equal(invalidIdResponse.payload.message, 'Invalid customer ID')

  const unsupportedResponse = responseRecorder()
  await updateCustomer({ params: { id: '7' }, body: { current_balance: 0 }, user: { user_id: 2 } }, unsupportedResponse)
  assert.equal(unsupportedResponse.statusCode, 400)
  assert.equal(unsupportedResponse.payload.message, 'Only customer name, contact number, and address can be updated')

  const emptyNameResponse = responseRecorder()
  await updateCustomer({ params: { id: '7' }, body: { customer_name: '   ' }, user: { user_id: 2 } }, emptyNameResponse)
  assert.equal(emptyNameResponse.statusCode, 400)
  assert.equal(emptyNameResponse.payload.message, 'Customer name is required')
})

test('a nonexistent customer returns 404 and rolls back', async () => {
  const connection = fakeCustomerConnection({ exists: false })
  const response = responseRecorder()
  await withFakeConnection(connection, () => updateCustomer({
    params: { id: '999' }, body: { customer_name: 'Missing Customer' }, user: { user_id: 2 },
  }, response))
  assert.equal(response.statusCode, 404)
  assert.equal(response.payload.message, 'Customer not found')
  assert.equal(connection.state.committed, false)
  assert.equal(connection.state.rolledBack, true)
  assert.equal(connection.state.released, true)
})

test('the customer update route rejects unauthenticated requests', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/customers', customerRoutes)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  try {
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/api/customers/7`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Blocked' }),
    })
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { success: false, message: 'Authentication required' })
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
