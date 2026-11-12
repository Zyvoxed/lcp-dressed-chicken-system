import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { archiveCustomer, getArchivedCustomers, restoreCustomer } from '../controllers/customerController.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function fakeConnection({ balance = '0.00', active = true, exists = true } = {}) {
  const state = { committed: false, rolledBack: false, released: false, active, activity: null, updateSql: '' }
  const connection = {
    state,
    async beginTransaction() {},
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    release() { state.released = true },
    async execute(sql, parameters) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT customer_id, customer_name, current_balance, is_active')) {
        return [exists ? [{ customer_id: 7, customer_name: 'Maria Santos', current_balance: balance, is_active: state.active }] : []]
      }
      if (normalized.startsWith('SELECT customer_id, customer_name, is_active')) {
        return [exists ? [{ customer_id: 7, customer_name: 'Maria Santos', is_active: state.active }] : []]
      }
      if (normalized.startsWith('UPDATE customers SET is_active')) {
        state.updateSql = normalized
        state.active = normalized.includes('is_active = TRUE')
        return [{ affectedRows: 1 }]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) {
        state.activity = { userId: parameters[0], description: parameters[1] }
        return [{ insertId: 51 }]
      }
      throw new Error(`Unexpected test query: ${normalized}`)
    },
  }
  return connection
}

async function withConnection(connection, callback) {
  const original = pool.getConnection
  pool.getConnection = async () => connection
  try { await callback() } finally { pool.getConnection = original }
}

test('admin can archive a settled customer and the action is logged transactionally', async () => {
  const connection = fakeConnection()
  const response = responseRecorder()
  await withConnection(connection, () => archiveCustomer({ params: { id: '7' }, user: { user_id: 2 } }, response))
  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.data.is_active, false)
  assert.equal(connection.state.active, false)
  assert.equal(connection.state.committed, true)
  assert.equal(connection.state.rolledBack, false)
  assert.deepEqual(connection.state.activity, { userId: 2, description: 'Customer 7 (Maria Santos) archived' })
  assert.equal(connection.state.released, true)
})

test('customer with an outstanding balance cannot be archived', async () => {
  const connection = fakeConnection({ balance: '25.00' })
  const response = responseRecorder()
  await withConnection(connection, () => archiveCustomer({ params: { id: '7' }, user: { user_id: 2 } }, response))
  assert.equal(response.statusCode, 409)
  assert.match(response.payload.message, /outstanding balance/i)
  assert.equal(connection.state.active, true)
  assert.equal(connection.state.committed, false)
  assert.equal(connection.state.rolledBack, true)
})

test('archive and restore reject duplicate state changes and missing customers', async () => {
  const alreadyArchived = fakeConnection({ active: false })
  const archiveResponse = responseRecorder()
  await withConnection(alreadyArchived, () => archiveCustomer({ params: { id: '7' }, user: { user_id: 2 } }, archiveResponse))
  assert.equal(archiveResponse.statusCode, 409)
  assert.equal(alreadyArchived.state.rolledBack, true)

  const missing = fakeConnection({ exists: false })
  const missingResponse = responseRecorder()
  await withConnection(missing, () => restoreCustomer({ params: { id: '7' }, user: { user_id: 2 } }, missingResponse))
  assert.equal(missingResponse.statusCode, 404)
  assert.equal(missing.state.rolledBack, true)
})

test('admin can restore an archived customer and restoration is logged', async () => {
  const connection = fakeConnection({ active: false })
  const response = responseRecorder()
  await withConnection(connection, () => restoreCustomer({ params: { id: '7' }, user: { user_id: 9 } }, response))
  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.data.is_active, true)
  assert.equal(connection.state.active, true)
  assert.deepEqual(connection.state.activity, { userId: 9, description: 'Customer 7 (Maria Santos) restored' })
  assert.equal(connection.state.committed, true)
})

test('archived customer retrieval filters on is_active false', async () => {
  const original = pool.execute
  let sql = ''
  pool.execute = async (query) => { sql = query; return [[{ customer_id: 7, is_active: 0 }]] }
  const response = responseRecorder()
  try { await getArchivedCustomers({}, response) } finally { pool.execute = original }
  assert.equal(response.statusCode, 200)
  assert.match(sql, /WHERE c\.is_active = FALSE/)
})

test('only Admin role passes archive and restore authorization', () => {
  const authorize = authorizeRoles('Admin')
  const staffResponse = responseRecorder()
  authorize({ user: { role: 'Staff' } }, staffResponse, () => assert.fail('Staff must be rejected'))
  assert.equal(staffResponse.statusCode, 403)
  const adminResponse = responseRecorder()
  let continued = false
  authorize({ user: { role: 'Admin' } }, adminResponse, () => { continued = true })
  assert.equal(continued, true)
})
