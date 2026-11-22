import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import pool from '../config/database.js'
import supplierRoutes from '../routes/supplierRoutes.js'

test('supplier API enforces required fields and updates records in place for Admins only', async () => {
  const originalExecute = pool.execute
  const originalGetConnection = pool.getConnection
  const originalSecret = process.env.JWT_SECRET
  const secret = 'supplier-update-test-secret'
  const state = {
    users: new Map([
      [1, { role: 'Admin', is_active: 1, auth_version: 0 }],
      [2, { role: 'Staff', is_active: 1, auth_version: 0 }],
    ]),
    suppliers: new Map(),
    nextSupplierId: 71,
    updateParameters: null,
    updateCount: 0,
    activity: [],
    protectedRecords: { stockIn: [{ stockin_id: 9, supplier_id: 71, total_cost: '320.00' }], fifoAllocations: [{ allocation_id: 3, stockin_id: 9 }], inventoryQuantity: '4.000' },
  }
  state.suppliers.set(88, {
    supplier_id: 88,
    supplier_name: 'Legacy Supplier',
    contact_person: null,
    contact_number: null,
    address: null,
    is_active: true,
  })

  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT supplier_id, supplier_name, is_active FROM suppliers')) {
        const supplier = state.suppliers.get(Number(parameters[0]))
        return [supplier ? [{ ...supplier }] : []]
      }
      if (normalized.startsWith('UPDATE suppliers SET supplier_name')) {
        const supplierId = Number(parameters[4])
        const existing = state.suppliers.get(supplierId)
        assert.ok(existing, 'update must target an existing supplier ID')
        state.updateParameters = [...parameters]
        state.updateCount += 1
        state.suppliers.set(supplierId, {
          ...existing,
          supplier_name: parameters[0],
          contact_person: parameters[1],
          contact_number: parameters[2],
          address: parameters[3],
        })
        return [{ affectedRows: 1 }]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) {
        state.activity.push({ userId: parameters[0], action: 'SUPPLIER_UPDATED', description: parameters[1] })
        return [{ insertId: 1 }]
      }
      throw new Error(`Unexpected update query: ${normalized}`)
    },
  }

  process.env.JWT_SECRET = secret
  pool.execute = async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized.startsWith('SELECT role, is_active, auth_version FROM users')) {
      const user = state.users.get(Number(parameters[0]))
      return [user ? [{ ...user }] : []]
    }
    if (normalized.startsWith('SELECT supplier_id, supplier_name, contact_person, contact_number, address, created_at FROM suppliers')) {
      return [[...state.suppliers.values()].filter((supplier) => supplier.is_active)]
    }
    if (normalized.startsWith('INSERT INTO suppliers')) {
      const supplierId = state.nextSupplierId++
      state.suppliers.set(supplierId, {
        supplier_id: supplierId,
        supplier_name: parameters[0],
        contact_person: parameters[1],
        contact_number: parameters[2],
        address: parameters[3],
        is_active: true,
      })
      return [{ insertId: supplierId }]
    }
    throw new Error(`Unexpected pool query: ${normalized}`)
  }
  pool.getConnection = async () => connection

  const app = express()
  app.use(express.json())
  app.use('/api/suppliers', supplierRoutes)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  const origin = `http://127.0.0.1:${server.address().port}`
  const tokenFor = (userId, role) => jwt.sign(
    { user_id: userId, role, auth_version: 0, mfa_verified: true },
    secret,
    { expiresIn: '2m' },
  )
  const adminToken = tokenFor(1, 'Admin')
  const staffToken = tokenFor(2, 'Staff')
  const call = (path, token, method, body) => fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  try {
    const staffCreate = await call('/api/suppliers', staffToken, 'POST', {
      supplier_name: 'Blocked Supplier', contact_number: '09170000000', address: 'Manila',
    })
    assert.equal(staffCreate.status, 403)

    const validCreate = await call('/api/suppliers', adminToken, 'POST', {
      supplier_name: '  Farm Supply  ', contact_person: '  Ana Cruz ', contact_number: ' 0917-000-0000 ', address: '  Lot 4, Quezon City.  ',
    })
    assert.equal(validCreate.status, 201)
    const created = await validCreate.json()
    assert.equal(created.data.supplier_id, 71)
    assert.deepEqual(state.suppliers.get(71), {
      supplier_id: 71,
      supplier_name: 'Farm Supply',
      contact_person: 'Ana Cruz',
      contact_number: '0917-000-0000',
      address: 'Lot 4, Quezon City.',
      is_active: true,
    })

    for (const [field, value] of [
      ['contact_number', ''],
      ['contact_number', '   '],
      ['contact_number', null],
      ['address', ''],
      ['address', '   '],
      ['address', null],
    ]) {
      const body = { supplier_name: 'Rejected Supplier', contact_number: '09170000000', address: 'Makati' }
      body[field] = value
      const response = await call('/api/suppliers', adminToken, 'POST', body)
      assert.equal(response.status, 400, `create should reject ${field} value ${JSON.stringify(value)}`)
      assert.equal(state.suppliers.size, 2, 'invalid creation must not insert a supplier')
    }

    for (const [field, value] of [
      ['contact_number', ''],
      ['contact_number', '   '],
      ['contact_number', null],
      ['address', ''],
      ['address', '   '],
      ['address', null],
    ]) {
      const body = { supplier_name: 'Farm Supply', contact_number: '09170000000', address: 'Makati' }
      body[field] = value
      const response = await call('/api/suppliers/71', adminToken, 'PATCH', body)
      assert.equal(response.status, 400, `${field} value ${JSON.stringify(value)} should be rejected`)
      assert.equal(state.updateCount, 0)
    }

    const missingDetails = await call('/api/suppliers/71', adminToken, 'PATCH', { supplier_name: 'Farm Supply' })
    assert.equal(missingDetails.status, 400)

    const legacyResponse = await call('/api/suppliers', adminToken, 'GET')
    assert.equal(legacyResponse.status, 200)
    const legacyData = (await legacyResponse.json()).data.find((supplier) => supplier.supplier_id === 88)
    assert.equal(legacyData.contact_number, null)
    assert.equal(legacyData.address, null)
    assert.equal(state.suppliers.get(88).contact_number, null)
    assert.equal(state.suppliers.get(88).address, null)

    const staffUpdate = await call('/api/suppliers/71', staffToken, 'PATCH', {
      supplier_name: 'Unauthorized Rename', contact_number: '09170000000', address: 'Makati',
    })
    assert.equal(staffUpdate.status, 403)
    assert.equal(state.updateCount, 0)

    const invalidId = await call('/api/suppliers/71x', adminToken, 'PATCH', {
      supplier_name: 'Farm Supply', contact_number: '09170000000', address: 'Makati',
    })
    assert.equal(invalidId.status, 400)
    const missingSupplier = await call('/api/suppliers/999', adminToken, 'PATCH', {
      supplier_name: 'Farm Supply', contact_number: '09170000000', address: 'Makati',
    })
    assert.equal(missingSupplier.status, 404)

    state.suppliers.get(71).is_active = false
    const updateResponse = await call('/api/suppliers/71', adminToken, 'PATCH', {
      supplier_name: '  Updated Farm  ', contact_person: '  ', contact_number: ' +63 (917) 000-0000 ', address: '  Unit 2, Brgy. Malaya, Quezon City.  ',
    })
    assert.equal(updateResponse.status, 200)
    const updated = await updateResponse.json()
    assert.deepEqual(updated.data, {
      supplier_id: 71,
      supplier_name: 'Updated Farm',
      contact_person: null,
      contact_number: '+63 (917) 000-0000',
      address: 'Unit 2, Brgy. Malaya, Quezon City.',
      is_active: false,
    })
    assert.equal(state.suppliers.get(71).supplier_id, 71)
    assert.equal(state.suppliers.get(71).is_active, false)
    assert.deepEqual(state.updateParameters, [
      'Updated Farm', null, '+63 (917) 000-0000', 'Unit 2, Brgy. Malaya, Quezon City.', 71,
    ])
    assert.deepEqual(state.protectedRecords, {
      stockIn: [{ stockin_id: 9, supplier_id: 71, total_cost: '320.00' }],
      fifoAllocations: [{ allocation_id: 3, stockin_id: 9 }],
      inventoryQuantity: '4.000',
    })
    assert.deepEqual(state.activity, [{
      userId: 1,
      action: 'SUPPLIER_UPDATED',
      description: 'Supplier 71 (Updated Farm) details updated',
    }])
  } finally {
    await new Promise((resolve) => server.close(resolve))
    pool.execute = originalExecute
    pool.getConnection = originalGetConnection
    if (originalSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = originalSecret
  }
})
