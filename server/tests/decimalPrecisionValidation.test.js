import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { createProduct } from '../controllers/productController.js'
import { recordPayment } from '../controllers/paymentController.js'
import { createSale } from '../controllers/salesController.js'
import { createStockIn } from '../controllers/stockInController.js'
import { decimalLimits, parseDecimal } from '../utils/decimalValidation.js'

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function validSaleBody(overrides = {}) {
  return {
    payment_type: 'Cash',
    amount_paid: '185.50',
    items: [{ product_id: 1, quantity: '1' }],
    ...overrides,
  }
}

test('decimal parser accepts supported quantity and money values', () => {
  for (const value of [1, 1.5, 1.25, 1.125, '1.1250', decimalLimits.quantity]) {
    assert.equal(parseDecimal(value, {
      fieldName: 'Quantity', maximum: decimalLimits.quantity, decimalPlaces: 3,
      minimum: 0, inclusiveMinimum: false,
    }), Number(value))
  }
  for (const value of [0, 185.5, '185.50', '185.5000', decimalLimits.unitPrice]) {
    assert.equal(parseDecimal(value, {
      fieldName: 'Cost price', maximum: decimalLimits.unitPrice, decimalPlaces: 2,
    }), Number(value))
  }
})

test('decimal parser rejects malformed, non-finite, over-precision, and oversized values', () => {
  const options = {
    fieldName: 'Quantity', maximum: decimalLimits.quantity, decimalPlaces: 3,
    minimum: 0, inclusiveMinimum: false,
  }
  for (const value of ['1.1234', 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1e3', '12kg', '', decimalLimits.quantity + 1]) {
    assert.throws(() => parseDecimal(value, options))
  }
  assert.throws(() => parseDecimal('185.501', {
    fieldName: 'Cost price', maximum: decimalLimits.unitPrice, decimalPlaces: 2,
  }), /2 decimal places/)
})

test('invalid sale values are rejected before any database transaction or write', async () => {
  const originalGetConnection = pool.getConnection
  let databaseCalls = 0
  pool.getConnection = async () => { databaseCalls += 1; throw new Error('Database must not be reached') }
  try {
    const cases = [
      [validSaleBody({ items: [{ product_id: 1, quantity: '1.1234' }] }), 'Quantity supports up to 3 decimal places'],
      [validSaleBody({ items: [{ product_id: 1, quantity: 0 }] }), 'Quantity must be greater than 0'],
      [validSaleBody({ items: [{ product_id: 1, quantity: -1 }] }), 'Quantity must be greater than 0'],
      [validSaleBody({ items: [{ product_id: 1, quantity: 'bad' }] }), 'Quantity must be a valid number'],
      [validSaleBody({ items: [{ product_id: 1, quantity: decimalLimits.quantity + 1 }] }), `Quantity must not exceed ${decimalLimits.quantity}`],
      [validSaleBody({ amount_paid: '185.501' }), 'Amount paid supports up to 2 decimal places'],
      [validSaleBody({ amount_paid: decimalLimits.money + 1 }), `Amount paid must not exceed ${decimalLimits.money}`],
      [validSaleBody({ items: [{ product_id: 1, quantity: 1, price: '1.001' }] }), 'Sale item prices are determined by the registered product price'],
    ]
    for (const [body, message] of cases) {
      const response = responseRecorder()
      await createSale({ body, user: { user_id: 2 } }, response)
      assert.equal(response.statusCode, 400)
      assert.equal(response.payload.message, message)
    }
    assert.equal(databaseCalls, 0)
  } finally {
    pool.getConnection = originalGetConnection
  }
})

test('invalid Stock In values are rejected before any database transaction or write', async () => {
  const originalGetConnection = pool.getConnection
  let databaseCalls = 0
  pool.getConnection = async () => { databaseCalls += 1; throw new Error('Database must not be reached') }
  const base = { supplier_id: 1, product_id: 1, quantity_received: '1.125', cost_price: '185.50', delivery_date: '2026-10-22T10:00' }
  try {
    const cases = [
      [{ ...base, quantity_received: '1.1234' }, 'Quantity received supports up to 3 decimal places'],
      [{ ...base, quantity_received: 0 }, 'Quantity received must be greater than 0'],
      [{ ...base, quantity_received: 'Infinity' }, 'Quantity received must be a valid number'],
      [{ ...base, cost_price: '185.501' }, 'Cost price supports up to 2 decimal places'],
      [{ ...base, cost_price: decimalLimits.unitPrice + 1 }, `Cost price must not exceed ${decimalLimits.unitPrice}`],
      [{ ...base, quantity_received: decimalLimits.quantity, cost_price: decimalLimits.unitPrice }, `Total cost must not exceed ${decimalLimits.money}`],
    ]
    for (const [body, message] of cases) {
      const response = responseRecorder()
      await createStockIn({ body, user: { user_id: 2 } }, response)
      assert.equal(response.statusCode, 400)
      assert.equal(response.payload.message, message)
    }
    assert.equal(databaseCalls, 0)
  } finally {
    pool.getConnection = originalGetConnection
  }
})

test('invalid standalone payment precision is rejected before database access', async () => {
  const originalGetConnection = pool.getConnection
  let databaseCalls = 0
  pool.getConnection = async () => { databaseCalls += 1; throw new Error('Database must not be reached') }
  try {
    for (const paymentAmount of ['10.001', 0, -1, 'NaN', decimalLimits.money + 1]) {
      const response = responseRecorder()
      await recordPayment({ body: { sale_id: 1, payment_amount: paymentAmount }, user: { user_id: 2 } }, response)
      assert.equal(response.statusCode, 400)
    }
    assert.equal(databaseCalls, 0)
  } finally {
    pool.getConnection = originalGetConnection
  }
})

test('selling price precision remains protected before product creation writes', async () => {
  const originalExecute = pool.execute
  let databaseCalls = 0
  pool.execute = async () => { databaseCalls += 1; throw new Error('Database must not be reached') }
  try {
    const response = responseRecorder()
    await createProduct({ body: {
      product_name: 'Precision Test', category: 'Whole Chicken', unit: 'kg',
      selling_price: '185.501', reorder_level: '1.125',
    } }, response)
    assert.equal(response.statusCode, 400)
    assert.match(response.payload.message, /2 decimal places/)
    assert.equal(databaseCalls, 0)
  } finally {
    pool.execute = originalExecute
  }
})

test('valid three-decimal sale quantities preserve registered pricing and FIFO writes', async () => {
  const originalGetConnection = pool.getConnection
  const state = { committed: false, rolledBack: false, writes: [] }
  const connection = {
    async beginTransaction() {},
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    release() {},
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT product_id, selling_price')) {
        return [[{ product_id: 1, selling_price: '185.50', stock_quantity: '10.000', reorder_level: '1.000' }]]
      }
      if (normalized.startsWith('SELECT stockin_id')) {
        return [[{ stockin_id: 10, remaining_quantity: '10.000', cost_price: '150.00', delivery_date: '2026-01-01' }]]
      }
      state.writes.push({ sql: normalized, parameters })
      if (normalized.startsWith('INSERT INTO sales (')) return [{ insertId: 101 }]
      if (normalized.startsWith('INSERT INTO sales_items')) return [{ insertId: 201 }]
      return [{ affectedRows: 1 }]
    },
  }
  pool.getConnection = async () => connection
  try {
    const response = responseRecorder()
    await createSale({
      body: { payment_type: 'Cash', amount_paid: '208.69', items: [{ product_id: 1, quantity: '1.125' }] },
      user: { user_id: 2 },
    }, response)
    assert.equal(response.statusCode, 201)
    assert.equal(response.payload.data.total_amount, '208.69')
    assert.equal(state.committed, true)
    assert.equal(state.rolledBack, false)
    const itemWrite = state.writes.find((write) => write.sql.startsWith('INSERT INTO sales_items'))
    assert.deepEqual(itemWrite.parameters.slice(1), [1, '1.125', '185.50', '208.69'])
    assert(state.writes.some((write) => write.sql.startsWith('INSERT INTO sale_batch_allocations')))
  } finally {
    pool.getConnection = originalGetConnection
  }
})

test('valid Stock In quantity and cost preserve existing batch calculations', async () => {
  const originalGetConnection = pool.getConnection
  const state = { committed: false, rolledBack: false, writes: [] }
  const connection = {
    async beginTransaction() {},
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    release() {},
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT supplier_id')) return [[{ supplier_id: 1 }]]
      if (normalized.startsWith('SELECT product_id, stock_quantity')) {
        return [[{ product_id: 1, stock_quantity: '10.000', reorder_level: '2.000' }]]
      }
      state.writes.push({ sql: normalized, parameters })
      if (normalized.startsWith('INSERT INTO stock_in')) return [{ insertId: 301 }]
      return [{ affectedRows: 1 }]
    },
  }
  pool.getConnection = async () => connection
  try {
    const response = responseRecorder()
    await createStockIn({
      body: {
        supplier_id: 1, product_id: 1, quantity_received: '1.125',
        cost_price: '185.50', delivery_date: '2026-10-22T10:00',
      },
      user: { user_id: 2 },
    }, response)
    assert.equal(response.statusCode, 201)
    assert.equal(response.payload.data.quantity_received, '1.125')
    assert.equal(response.payload.data.cost_price, '185.50')
    assert.equal(response.payload.data.total_cost, '208.69')
    assert.equal(state.committed, true)
    assert.equal(state.rolledBack, false)
    assert(state.writes.some((write) => write.sql.startsWith('INSERT INTO stock_in')))
    assert(state.writes.some((write) => write.sql.startsWith('INSERT INTO activity_logs')))
  } finally {
    pool.getConnection = originalGetConnection
  }
})

test('valid two-decimal standalone payments retain existing balance updates', async () => {
  const originalGetConnection = pool.getConnection
  const state = { committed: false, rolledBack: false, writes: [] }
  const connection = {
    async beginTransaction() {},
    async commit() { state.committed = true },
    async rollback() { state.rolledBack = true },
    release() {},
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT customer_id, payment_type')) {
        return [[{ customer_id: 7, payment_type: 'Credit', total_amount: '300.00', amount_paid: '100.00', remaining_balance: '200.00', status: 'Partially Paid' }]]
      }
      if (normalized.startsWith('SELECT current_balance')) return [[{ current_balance: '200.00' }]]
      state.writes.push({ sql: normalized, parameters })
      if (normalized.startsWith('INSERT INTO payments')) return [{ insertId: 401 }]
      return [{ affectedRows: 1 }]
    },
  }
  pool.getConnection = async () => connection
  try {
    const response = responseRecorder()
    await recordPayment({ body: { sale_id: 9, payment_amount: '185.50' }, user: { user_id: 2 } }, response)
    assert.equal(response.statusCode, 201)
    assert.equal(response.payload.data.payment_amount, '185.50')
    assert.equal(response.payload.data.remaining_balance, '14.50')
    assert.equal(state.committed, true)
    assert.equal(state.rolledBack, false)
  } finally {
    pool.getConnection = originalGetConnection
  }
})

test('derived DECIMAL overflow is rejected without business-record writes', async () => {
  const originalGetConnection = pool.getConnection
  const saleState = { writes: 0, rolledBack: false }
  const saleConnection = {
    async beginTransaction() {}, async commit() {},
    async rollback() { saleState.rolledBack = true }, release() {},
    async execute(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('SELECT product_id, selling_price')) {
        return [[{ product_id: 1, selling_price: '99999999.99', stock_quantity: '9999999.999', reorder_level: '0.000' }]]
      }
      if (normalized.startsWith('SELECT stockin_id')) {
        return [[{ stockin_id: 1, remaining_quantity: '9999999.999', cost_price: '1.00', delivery_date: '2026-01-01' }]]
      }
      saleState.writes += 1
      return [{ affectedRows: 1 }]
    },
  }
  pool.getConnection = async () => saleConnection
  try {
    const saleResponse = responseRecorder()
    await createSale({
      body: { payment_type: 'Cash', amount_paid: 0, items: [{ product_id: 1, quantity: decimalLimits.quantity }] },
      user: { user_id: 2 },
    }, saleResponse)
    assert.equal(saleResponse.statusCode, 400)
    assert.match(saleResponse.payload.message, /Sale item total/)
    assert.equal(saleState.writes, 0)
    assert.equal(saleState.rolledBack, true)

    const stockState = { writes: 0, rolledBack: false }
    const stockConnection = {
      async beginTransaction() {}, async commit() {},
      async rollback() { stockState.rolledBack = true }, release() {},
      async execute(sql) {
        const normalized = sql.replace(/\s+/g, ' ').trim()
        if (normalized.startsWith('SELECT supplier_id')) return [[{ supplier_id: 1 }]]
        if (normalized.startsWith('SELECT product_id, stock_quantity')) {
          return [[{ product_id: 1, stock_quantity: '9999999.999', reorder_level: '1.000' }]]
        }
        stockState.writes += 1
        return [{ affectedRows: 1 }]
      },
    }
    pool.getConnection = async () => stockConnection
    const stockResponse = responseRecorder()
    await createStockIn({
      body: { supplier_id: 1, product_id: 1, quantity_received: '0.001', cost_price: '1.00', delivery_date: '2026-10-22T10:00' },
      user: { user_id: 2 },
    }, stockResponse)
    assert.equal(stockResponse.statusCode, 400)
    assert.match(stockResponse.payload.message, /Resulting product stock/)
    assert.equal(stockState.writes, 0)
    assert.equal(stockState.rolledBack, true)
  } finally {
    pool.getConnection = originalGetConnection
  }
})
