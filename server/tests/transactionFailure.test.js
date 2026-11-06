import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { recordPayment } from '../controllers/paymentController.js'
import { createSale } from '../controllers/salesController.js'
import { createStockIn } from '../controllers/stockInController.js'

let keyNumber = 0

function request(body) {
  keyNumber += 1
  return {
    body,
    user: { user_id: 7 },
    get(name) {
      return name.toLowerCase() === 'idempotency-key' ? `transaction-failure-test-${keyNumber}` : undefined
    },
  }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function connectionFor(options) {
  const { execute } = options
  return {
    async beginTransaction() {},
    execute,
    rollback: options.rollback || (async function rollbackTransaction() {}),
    commit: options.commit || (async function commitTransaction() {}),
    releases: 0,
    destroys: 0,
    release() { this.releases += 1 },
    destroy() { this.destroys += 1 },
  }
}

async function withConnection(connection, action) {
  const original = pool.getConnection
  pool.getConnection = async () => connection
  try {
    return await action()
  } finally {
    pool.getConnection = original
  }
}

test('confirmed sale, stock-in, and payment rejections include not-committed outcome', async () => {
  const cases = [
    {
      run: createSale,
      body: { payment_type: 'Credit', amount_paid: '0.00', customer_id: 9, items: [{ product_id: 1, quantity: '1' }] },
      rejectAt: 'customer',
      expectedMessage: 'Active customer not found',
    },
    {
      run: createStockIn,
      body: { supplier_id: 9, product_id: 1, quantity_received: '1', cost_price: '2.00', delivery_date: '2026-11-07T04:00' },
      rejectAt: 'supplier',
      expectedMessage: 'Active supplier not found',
    },
    {
      run: recordPayment,
      body: { sale_id: 9, payment_amount: '1.00' },
      rejectAt: 'sale',
      expectedMessage: 'Sale not found',
    },
  ]

  for (const testCase of cases) {
    const connection = connectionFor({
      async execute(sql) {
        if (sql.includes('FROM customers')) return [[], []]
        if (sql.includes('FROM suppliers')) return [[], []]
        if (sql.includes('FROM sales WHERE')) return [[], []]
        return [{ affectedRows: 1 }, []]
      },
    })
    const result = response()
    await withConnection(connection, () => testCase.run(request(testCase.body), result))
    assert.equal(result.body.message, testCase.expectedMessage)
    assert.equal(result.body.code, 'TRANSACTION_REJECTED')
    assert.equal(result.body.transaction_outcome, 'not_committed')
    assert.equal(connection.releases, 1)
    assert.equal(connection.destroys, 0)
  }
})

test('rollback failure returns unknown outcome and discards the connection', async () => {
  const connection = connectionFor({
    async execute(sql) {
      return sql.includes('FROM suppliers') ? [[], []] : [{ affectedRows: 1 }, []]
    },
    async rollback() {
      const error = new Error('rollback failed')
      error.code = 'ER_TEST_ROLLBACK'
      throw error
    },
  })
  connection.destroy = function destroyConnection() {
    this.destroys += 1
    throw new Error('connection disposal failed')
  }
  const result = response()
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    await withConnection(connection, () => createStockIn(request({
      supplier_id: 9,
      product_id: 1,
      quantity_received: '1',
      cost_price: '2.00',
      delivery_date: '2026-11-07T04:00',
    }), result))
  } finally {
    console.error = originalConsoleError
  }
  assert.equal(result.statusCode, 500)
  assert.equal(result.body.code, 'TRANSACTION_OUTCOME_UNKNOWN')
  assert.equal(result.body.transaction_outcome, 'unknown')
  assert.equal(connection.destroys, 1)
  assert.equal(connection.releases, 0)
})

test('commit acknowledgement failure is unknown and does not attempt rollback or pool release', async () => {
  const connection = connectionFor({
    async execute(sql) {
      if (sql.includes('FROM suppliers')) return [[{ supplier_id: 2 }], []]
      if (sql.includes('FROM products')) return [[{ product_id: 1, stock_quantity: '0.000', reorder_level: '1.000' }], []]
      if (sql.startsWith('INSERT INTO stock_in')) return [{ insertId: 12 }, []]
      return [{ affectedRows: 1 }, []]
    },
    async commit() {
      const error = new Error('commit acknowledgement lost')
      error.code = 'ER_TEST_COMMIT'
      throw error
    },
    async rollback() {
      assert.fail('Rollback must not be used to infer the outcome after commit was attempted')
    },
  })
  const result = response()
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    await withConnection(connection, () => createStockIn(request({
      supplier_id: 2,
      product_id: 1,
      quantity_received: '1',
      cost_price: '2.00',
      delivery_date: '2026-11-07T04:00',
    }), result))
  } finally {
    console.error = originalConsoleError
  }
  assert.equal(result.statusCode, 500)
  assert.equal(result.body.transaction_outcome, 'unknown')
  assert.equal(connection.destroys, 1)
  assert.equal(connection.releases, 0)
})
