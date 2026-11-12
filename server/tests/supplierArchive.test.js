import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import {
  archiveSupplier,
  getArchivedSuppliers,
  restoreSupplier,
} from '../controllers/supplierController.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function fakeConnection({ active = true, exists = true } = {}) {
  const state = { active, committed: false, rolledBack: false, released: false, activity: null }
  return {
    state,
    async beginTransaction() {},
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    release() { state.released = true },
    async execute(sql, parameters) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT supplier_id, supplier_name, is_active')) {
        return [exists ? [{ supplier_id: 11, supplier_name: 'Poultry Farm', is_active: state.active }] : []]
      }
      if (normalized.startsWith('UPDATE suppliers SET is_active')) {
        state.active = normalized.includes('is_active = TRUE')
        assert.deepEqual(parameters, [11])
        return [{ affectedRows: 1 }]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) {
        state.activity = { userId: parameters[0], action: parameters[1], description: parameters[2] }
        return [{ insertId: 70 }]
      }
      throw new Error(`Unexpected test query: ${normalized}`)
    },
  }
}

async function withConnection(connection, callback) {
  const original = pool.getConnection
  pool.getConnection = async () => connection
  try { await callback() } finally { pool.getConnection = original }
}

test('admin archives an active supplier transactionally and records the actor', async () => {
  const connection = fakeConnection()
  const response = responseRecorder()
  await withConnection(connection, () => archiveSupplier({ params: { id: '11' }, user: { user_id: 3 } }, response))
  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.data.is_active, false)
  assert.equal(connection.state.active, false)
  assert.equal(connection.state.committed, true)
  assert.equal(connection.state.rolledBack, false)
  assert.deepEqual(connection.state.activity, {
    userId: 3,
    action: 'SUPPLIER_ARCHIVED',
    description: 'Supplier 11 (Poultry Farm) archived',
  })
  assert.equal(connection.state.released, true)
})

test('duplicate archive, invalid IDs, and missing suppliers are rejected', async () => {
  const archived = fakeConnection({ active: false })
  const duplicateResponse = responseRecorder()
  await withConnection(archived, () => archiveSupplier({ params: { id: '11' }, user: { user_id: 3 } }, duplicateResponse))
  assert.equal(duplicateResponse.statusCode, 409)
  assert.equal(archived.state.rolledBack, true)

  const invalidResponse = responseRecorder()
  await archiveSupplier({ params: { id: '11x' }, user: { user_id: 3 } }, invalidResponse)
  assert.equal(invalidResponse.statusCode, 400)

  const missing = fakeConnection({ exists: false })
  const missingResponse = responseRecorder()
  await withConnection(missing, () => restoreSupplier({ params: { id: '11' }, user: { user_id: 3 } }, missingResponse))
  assert.equal(missingResponse.statusCode, 404)
  assert.equal(missing.state.rolledBack, true)
})

test('admin restores an archived supplier and records the actor', async () => {
  const connection = fakeConnection({ active: false })
  const response = responseRecorder()
  await withConnection(connection, () => restoreSupplier({ params: { id: '11' }, user: { user_id: 8 } }, response))
  assert.equal(response.statusCode, 200)
  assert.equal(response.payload.data.is_active, true)
  assert.equal(connection.state.active, true)
  assert.equal(connection.state.committed, true)
  assert.deepEqual(connection.state.activity, {
    userId: 8,
    action: 'SUPPLIER_RESTORED',
    description: 'Supplier 11 (Poultry Farm) restored',
  })
})

test('archived supplier endpoint filters inactive suppliers', async () => {
  const original = pool.execute
  let query = ''
  pool.execute = async (sql) => { query = sql; return [[{ supplier_id: 11, is_active: 0 }]] }
  const response = responseRecorder()
  try { await getArchivedSuppliers({}, response) } finally { pool.execute = original }
  assert.equal(response.statusCode, 200)
  assert.match(query, /WHERE is_active = FALSE/)
})

test('only Admin role passes supplier archive and restore authorization', () => {
  const authorize = authorizeRoles('Admin')
  const staffResponse = responseRecorder()
  authorize({ user: { role: 'Staff' } }, staffResponse, () => assert.fail('Staff must be rejected'))
  assert.equal(staffResponse.statusCode, 403)
  let continued = false
  authorize({ user: { role: 'Admin' } }, responseRecorder(), () => { continued = true })
  assert.equal(continued, true)
})
