import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import pool from '../config/database.js'
import stockInRoutes from '../routes/stockInRoutes.js'
import supplierRoutes from '../routes/supplierRoutes.js'

const secret = 'supplier-stock-in-history-test-secret'

function makeState() {
  return {
    users: new Map([[1, { role: 'Admin', is_active: 1, auth_version: 0 }]]),
    suppliers: new Map(),
    products: new Map([[4, {
      product_id: 4,
      product_name: 'Chicken',
      unit: 'kg',
      stock_quantity: '20.000',
      reorder_level: '2.000',
      status: 'Available',
      is_active: 1,
    }]]),
    stockIns: [],
    idempotency: new Map(),
    activity: [],
    nextSupplierId: 51,
    nextStockInId: 91,
    rejectSupplierUpdate: false,
  }
}

function createHarness() {
  const state = makeState()
  const originalExecute = pool.execute
  const originalGetConnection = pool.getConnection
  const originalSecret = process.env.JWT_SECRET
  let working

  const connection = {
    async beginTransaction() {
      working = structuredClone({
        suppliers: state.suppliers,
        products: state.products,
        stockIns: state.stockIns,
        idempotency: state.idempotency,
        activity: state.activity,
        nextStockInId: state.nextStockInId,
      })
    },
    async commit() {
      state.suppliers = working.suppliers
      state.products = working.products
      state.stockIns = working.stockIns
      state.idempotency = working.idempotency
      state.activity = working.activity
      state.nextStockInId = working.nextStockInId
      working = null
    },
    async rollback() { working = null },
    release() {},
    async execute(sql, parameters = []) {
      const query = sql.replace(/\s+/g, ' ').trim()
      if (query.startsWith('INSERT INTO idempotency_records')) {
        const [userId, operation, key, requestHash] = parameters
        working.idempotency.set(`${userId}:${operation}:${key}`, {
          request_hash: Buffer.from(requestHash),
          response_status: null,
          response_body: null,
        })
        return [{ affectedRows: 1 }]
      }
      if (query.startsWith('UPDATE idempotency_records')) {
        const [status, body, userId, operation, key] = parameters
        const record = working.idempotency.get(`${userId}:${operation}:${key}`)
        if (!record) return [{ affectedRows: 0 }]
        record.response_status = status
        record.response_body = body
        return [{ affectedRows: 1 }]
      }
      if (query.startsWith('SELECT supplier_id FROM suppliers')) {
        const supplier = working.suppliers.get(Number(parameters[0]))
        return [supplier?.is_active ? [{ supplier_id: supplier.supplier_id }] : []]
      }
      if (query.startsWith('SELECT product_id, stock_quantity, reorder_level FROM products')) {
        const product = working.products.get(Number(parameters[0]))
        return [product?.is_active ? [{ ...product }] : []]
      }
      if (query.startsWith('INSERT INTO stock_in')) {
        const [supplierId, productId, userId, quantity, remaining, cost, total, deliveryDate] = parameters
        const stockinId = working.nextStockInId++
        working.stockIns.push({
          stockin_id: stockinId,
          supplier_id: supplierId,
          product_id: productId,
          user_id: userId,
          quantity_received: quantity,
          remaining_quantity: remaining,
          cost_price: cost,
          total_cost: total,
          delivery_date: deliveryDate,
          created_at: '2026-11-22 10:00:00',
        })
        return [{ insertId: stockinId }]
      }
      if (query.startsWith('UPDATE products SET stock_quantity = stock_quantity +')) {
        const [quantity, productId] = parameters
        const product = working.products.get(Number(productId))
        product.stock_quantity = (Number(product.stock_quantity) + Number(quantity)).toFixed(3)
        return [{ affectedRows: 1 }]
      }
      if (query.startsWith('UPDATE products SET status')) {
        const [status, productId] = parameters
        working.products.get(Number(productId)).status = status
        return [{ affectedRows: 1 }]
      }
      if (query.startsWith('INSERT INTO activity_logs')) {
        working.activity.push({ user_id: parameters[0], description: parameters[1] })
        return [{ insertId: working.activity.length }]
      }
      if (query.startsWith('SELECT supplier_id, supplier_name, is_active FROM suppliers')) {
        const supplier = working.suppliers.get(Number(parameters[0]))
        return [supplier ? [{ ...supplier }] : []]
      }
      if (query.startsWith('UPDATE suppliers SET supplier_name')) {
        if (state.rejectSupplierUpdate) {
          const error = new Error('simulated supplier-name uniqueness violation')
          error.code = 'ER_DUP_ENTRY'
          throw error
        }
        const [name, person, number, address, supplierId] = parameters
        const supplier = working.suppliers.get(Number(supplierId))
        if (!supplier) return [{ affectedRows: 0 }]
        Object.assign(supplier, {
          supplier_name: name,
          contact_person: person,
          contact_number: number,
          address,
        })
        return [{ affectedRows: 1 }]
      }
      throw new Error(`Unexpected transaction query: ${query}`)
    },
  }

  process.env.JWT_SECRET = secret
  pool.execute = async (sql, parameters = []) => {
    const query = sql.replace(/\s+/g, ' ').trim()
    if (query.startsWith('SELECT role, is_active, auth_version FROM users')) {
      const user = state.users.get(Number(parameters[0]))
      return [user ? [{ ...user }] : []]
    }
    if (query.startsWith('INSERT INTO suppliers')) {
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
    if (query.startsWith('SELECT supplier_id, supplier_name, contact_person, contact_number, address, created_at FROM suppliers')) {
      const isActive = query.includes('WHERE is_active = TRUE')
      return [[...state.suppliers.values()]
        .filter((supplier) => Boolean(supplier.is_active) === isActive)
        .map((supplier) => ({ ...supplier }))]
    }
    if (query.includes('FROM stock_in si') && query.includes('JOIN suppliers s')) {
      state.historySelectUsesCurrentSupplierJoin = /s\.supplier_name/.test(query)
      return [state.stockIns.flatMap((record) => {
        const supplier = state.suppliers.get(Number(record.supplier_id))
        const product = state.products.get(Number(record.product_id))
        const user = state.users.get(Number(record.user_id))
        if (!supplier || !product || !user) return []
        return [{
          ...record,
          supplier_name: supplier.supplier_name,
          product_name: product.product_name,
          unit: product.unit,
          recorded_by: 'Admin User',
        }]
      })]
    }
    throw new Error(`Unexpected pool query: ${query}`)
  }
  pool.getConnection = async () => connection

  const app = express()
  app.use(express.json())
  app.use('/api/suppliers', supplierRoutes)
  app.use('/api/stock-in', stockInRoutes)
  const server = app.listen(0, '127.0.0.1')

  async function start() {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    return `http://127.0.0.1:${server.address().port}`
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve))
    pool.execute = originalExecute
    pool.getConnection = originalGetConnection
    if (originalSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = originalSecret
  }

  return { state, start, close }
}

const adminToken = () => jwt.sign({
  user_id: 1,
  role: 'Admin',
  auth_version: 0,
  mfa_verified: true,
}, secret, { expiresIn: '2m' })

async function request(origin, path, { method = 'GET', body, key } = {}) {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function stockInBody(supplierId, overrides = {}) {
  return {
    supplier_id: supplierId,
    product_id: 4,
    quantity_received: '2.500',
    cost_price: '12.40',
    delivery_date: '2026-11-20T09:30',
    ...overrides,
  }
}

test('stock-in continues to use the product-configured unit without imposing a kilogram restriction', async () => {
  const harness = createHarness()
  const origin = await harness.start()
  try {
    harness.state.products.get(4).unit = 'tray'
    harness.state.suppliers.set(51, {
      supplier_id: 51,
      supplier_name: 'Configured Unit Supplier',
      contact_person: null,
      contact_number: '09170000000',
      address: 'Manila',
      is_active: true,
    })

    const stockInResponse = await request(origin, '/api/stock-in', {
      method: 'POST',
      key: 'configured-product-unit-stock-in',
      body: stockInBody(51, { quantity_received: '2.500' }),
    })
    assert.equal(stockInResponse.status, 201)
    const created = (await stockInResponse.json()).data
    assert.equal(created.quantity_received, '2.500')
    assert.equal(created.remaining_quantity, '2.500')
    assert.equal(harness.state.products.get(4).stock_quantity, '22.500')

    const historyResponse = await request(origin, '/api/stock-in')
    const [history] = (await historyResponse.json()).data
    assert.equal(history.unit, 'tray')
    assert.equal(history.quantity_received, '2.500')
  } finally {
    await harness.close()
  }
})

test('supplier rename changes the joined name shown for historical and new stock-in records while preserving their values', async () => {
  const harness = createHarness()
  const origin = await harness.start()
  try {
    const createdResponse = await request(origin, '/api/suppliers', {
      method: 'POST',
      body: {
        supplier_name: 'Original Poultry',
        contact_person: 'A. Santos',
        contact_number: '0917-555-0101',
        address: 'Market Road, Manila.',
      },
    })
    assert.equal(createdResponse.status, 201)
    const supplierId = (await createdResponse.json()).data.supplier_id

    const firstStockInResponse = await request(origin, '/api/stock-in', {
      method: 'POST',
      key: 'supplier-history-first',
      body: stockInBody(supplierId),
    })
    assert.equal(firstStockInResponse.status, 201)
    const firstStockInId = (await firstStockInResponse.json()).data.stockin_id
    assert.equal(harness.state.stockIns[0].supplier_id, supplierId)

    const beforeRename = await request(origin, '/api/stock-in')
    assert.equal(beforeRename.status, 200)
    const beforeRecords = (await beforeRename.json()).data
    assert.equal(beforeRecords[0].supplier_id, supplierId)
    assert.equal(beforeRecords[0].supplier_name, 'Original Poultry')

    const frozenHistory = harness.state.stockIns.map((record) => ({ ...record }))
    const frozenProduct = { ...harness.state.products.get(4) }
    const renameResponse = await request(origin, `/api/suppliers/${supplierId}`, {
      method: 'PATCH',
      body: {
        supplier_name: 'Renamed Poultry',
        contact_person: 'A. Santos',
        contact_number: '0917-555-0101',
        address: 'Market Road, Manila.',
      },
    })
    assert.equal(renameResponse.status, 200)
    assert.equal((await renameResponse.json()).data.supplier_id, supplierId)

    const secondStockInResponse = await request(origin, '/api/stock-in', {
      method: 'POST',
      key: 'supplier-history-second',
      body: stockInBody(supplierId, { quantity_received: '1.250' }),
    })
    assert.equal(secondStockInResponse.status, 201)
    const secondStockInId = (await secondStockInResponse.json()).data.stockin_id

    const afterRename = await request(origin, '/api/stock-in')
    assert.equal(afterRename.status, 200)
    const records = (await afterRename.json()).data
    assert.equal(records.length, 2)
    const historical = records.find((record) => record.stockin_id === firstStockInId)
    const newlyCreated = records.find((record) => record.stockin_id === secondStockInId)
    assert.ok(historical)
    assert.ok(newlyCreated)
    for (const record of [historical, newlyCreated]) {
      assert.equal(record.supplier_id, supplierId)
      assert.equal(record.supplier_name, 'Renamed Poultry')
    }
    assert.equal(harness.state.historySelectUsesCurrentSupplierJoin, true)
    assert.deepEqual(harness.state.stockIns[0], frozenHistory[0])
    assert.equal(historical.quantity_received, '2.500')
    assert.equal(historical.cost_price, '12.40')
    assert.equal(historical.total_cost, '31.00')
    assert.equal(newlyCreated.quantity_received, '1.250')
    assert.equal(newlyCreated.total_cost, '15.50')
    assert.equal(Number(harness.state.products.get(4).stock_quantity), 23.75)
    assert.equal(frozenProduct.stock_quantity, '22.500')
  } finally {
    await harness.close()
  }
})

test('contact-only supplier edits and archived status preserve stock-in references and values', async () => {
  const harness = createHarness()
  const origin = await harness.start()
  try {
    harness.state.suppliers.set(51, {
      supplier_id: 51,
      supplier_name: 'Existing Poultry',
      contact_person: 'Before',
      contact_number: '09170000000',
      address: 'Old Address',
      is_active: false,
    })
    harness.state.stockIns.push({
      stockin_id: 91,
      supplier_id: 51,
      product_id: 4,
      user_id: 1,
      quantity_received: '7.000',
      remaining_quantity: '3.000',
      cost_price: '9.25',
      total_cost: '64.75',
      delivery_date: '2026-11-01T08:00:00+08:00',
      created_at: '2026-11-01 08:00:00',
    })
    const savedHistory = structuredClone(harness.state.stockIns)
    const savedStock = harness.state.products.get(4).stock_quantity

    const update = await request(origin, '/api/suppliers/51', {
      method: 'PATCH',
      body: {
        supplier_name: 'Existing Poultry',
        contact_person: 'After',
        contact_number: '+63 (917) 000-0000',
        address: 'New Address, Quezon City.',
      },
    })
    assert.equal(update.status, 200)
    assert.equal((await update.json()).data.is_active, false)
    assert.deepEqual(harness.state.stockIns, savedHistory)
    assert.equal(harness.state.products.get(4).stock_quantity, savedStock)

    const historyResponse = await request(origin, '/api/stock-in')
    assert.equal(historyResponse.status, 200)
    const history = (await historyResponse.json()).data
    assert.equal(history.length, 1)
    assert.equal(history[0].supplier_id, 51)
    assert.equal(history[0].supplier_name, 'Existing Poultry')
    assert.equal(history[0].quantity_received, '7.000')
    assert.equal(history[0].total_cost, '64.75')

    const inactiveStockIn = await request(origin, '/api/stock-in', {
      method: 'POST',
      key: 'inactive-supplier-stock-in',
      body: stockInBody(51),
    })
    assert.equal(inactiveStockIn.status, 404)
    assert.equal(harness.state.stockIns.length, 1)
    assert.equal(harness.state.products.get(4).stock_quantity, savedStock)
  } finally {
    await harness.close()
  }
})

test('missing supplier references are rejected and supplier-name uniqueness follows the available schema', async () => {
  const harness = createHarness()
  const origin = await harness.start()
  try {
    harness.state.suppliers.set(51, {
      supplier_id: 51,
      supplier_name: 'Existing Poultry',
      contact_person: null,
      contact_number: '09170000000',
      address: 'Manila',
      is_active: true,
    })
    harness.state.suppliers.set(52, {
      supplier_id: 52,
      supplier_name: 'Other Poultry',
      contact_person: null,
      contact_number: '09170000001',
      address: 'Makati',
      is_active: true,
    })
    const originalStock = harness.state.products.get(4).stock_quantity

    const badReference = await request(origin, '/api/stock-in', {
      method: 'POST',
      key: 'missing-supplier-reference',
      body: stockInBody(999),
    })
    assert.equal(badReference.status, 404)
    assert.equal(harness.state.stockIns.length, 0)
    assert.equal(harness.state.products.get(4).stock_quantity, originalStock)

    // supplier_name has no UNIQUE constraint in the current schema, so the
    // controller allows this rename even when another supplier has that name.
    const duplicateNameAllowed = await request(origin, '/api/suppliers/51', {
      method: 'PATCH',
      body: {
        supplier_name: 'Other Poultry',
        contact_number: '09170000000',
        address: 'Manila',
      },
    })
    assert.equal(duplicateNameAllowed.status, 200)
    assert.equal(harness.state.suppliers.get(51).supplier_name, 'Other Poultry')

    const renamedSupplier = structuredClone(harness.state.suppliers.get(51))
    // A simulated database rejection verifies update rollback/error handling;
    // it does not imply that the repository schema currently has this rule.
    harness.state.rejectSupplierUpdate = true
    const duplicateName = await request(origin, '/api/suppliers/51', {
      method: 'PATCH',
      body: {
        supplier_name: 'Rejected Rename',
        contact_number: '09170000000',
        address: 'Manila',
      },
    })
    assert.equal(duplicateName.status, 500)
    assert.deepEqual(harness.state.suppliers.get(51), renamedSupplier)
    assert.deepEqual(harness.state.stockIns, [])
    assert.equal(harness.state.products.get(4).stock_quantity, originalStock)
  } finally {
    await harness.close()
  }
})
