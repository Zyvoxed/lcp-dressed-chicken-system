import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { recordPayment } from '../controllers/paymentController.js'
import { createStockIn } from '../controllers/stockInController.js'

let requestId = 0

function initialBusinessState() {
  return {
    products: new Map([[1, {
      product_id: 1,
      selling_price: '10.00',
      stock_quantity: '10.000',
      reorder_level: '2.000',
      status: 'Available',
      is_active: 1,
    }]]),
    suppliers: new Map([[2, { supplier_id: 2, is_active: 1 }]]),
    batches: new Map([[100, {
      stockin_id: 100,
      product_id: 1,
      remaining_quantity: '10.000',
      cost_price: '6.00',
      delivery_date: '2026-01-01 08:00:00',
    }]]),
    stockIns: [],
    sales: new Map([[50, {
      sale_id: 50,
      customer_id: 9,
      payment_type: 'Credit',
      total_amount: '185.50',
      amount_paid: '25.50',
      remaining_balance: '160.00',
      status: 'Partially Paid',
    }]]),
    customers: new Map([[9, { customer_id: 9, current_balance: '160.00', is_active: 1 }]]),
    payments: [],
    allocations: [],
  }
}

function scopeKey(userId, operation, key) {
  return JSON.stringify([userId, operation, key])
}

function createFixture({ failOnSql = null, failBegin = false, loseCommitAck = false } = {}) {
  const database = {
    business: initialBusinessState(),
    idempotencyRecords: new Map(),
    failOnSql,
    failBegin,
    loseCommitAck,
    connectionCount: 0,
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
    destroyCount: 0,
  }
  let nextStockInId = 101
  let nextPaymentId = 201
  const connection = {
    workingBusiness: null,
    workingIdempotency: null,
    async beginTransaction() {
      database.beginCount += 1
      if (database.failBegin) {
        const error = new Error('simulated transaction start failure')
        error.code = 'ER_TEST_BEGIN'
        throw error
      }
      this.workingBusiness = structuredClone(database.business)
      this.workingIdempotency = structuredClone(database.idempotencyRecords)
    },
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (database.failOnSql && normalized.startsWith(database.failOnSql)) {
        const failedStatement = database.failOnSql
        database.failOnSql = null
        const error = new Error(`simulated write failure: ${failedStatement}`)
        error.code = 'ER_TEST_WRITE'
        throw error
      }

      if (normalized.startsWith('INSERT INTO idempotency_records')) {
        const [userId, operation, key, requestHash] = parameters
        this.workingIdempotency.set(scopeKey(userId, operation, key), {
          user_id: userId,
          operation_type: operation,
          idempotency_key: key,
          request_hash: Buffer.from(requestHash),
          response_status: null,
          response_body: null,
        })
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('UPDATE idempotency_records')) {
        const record = this.workingIdempotency.get(scopeKey(parameters[2], parameters[3], parameters[4]))
        if (!record) return [{ affectedRows: 0 }, []]
        record.response_status = parameters[0]
        record.response_body = parameters[1]
        return [{ affectedRows: 1 }, []]
      }

      if (normalized.startsWith('SELECT customer_id, payment_type')) {
        const sale = this.workingBusiness.sales.get(parameters[0])
        return [sale ? [{ ...sale }] : [], []]
      }
      if (normalized.startsWith('SELECT current_balance')) {
        const customer = this.workingBusiness.customers.get(parameters[0])
        return [customer ? [{ current_balance: customer.current_balance }] : [], []]
      }
      if (normalized.startsWith('SELECT supplier_id FROM suppliers')) {
        const supplier = this.workingBusiness.suppliers.get(parameters[0])
        return [supplier?.is_active ? [{ supplier_id: supplier.supplier_id }] : [], []]
      }
      if (normalized.startsWith('SELECT product_id, stock_quantity')) {
        const product = this.workingBusiness.products.get(parameters[0])
        return [product?.is_active ? [{ ...product }] : [], []]
      }

      if (normalized.startsWith('UPDATE sales SET amount_paid')) {
        const sale = this.workingBusiness.sales.get(parameters[3])
        Object.assign(sale, {
          amount_paid: parameters[0],
          remaining_balance: parameters[1],
          status: parameters[2],
        })
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('UPDATE customers SET current_balance = current_balance -')) {
        const customer = this.workingBusiness.customers.get(parameters[1])
        customer.current_balance = amount(cents(customer.current_balance) - cents(parameters[0]))
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('INSERT INTO payments')) {
        const payment = {
          payment_id: nextPaymentId++,
          sale_id: parameters[0],
          customer_id: parameters[1],
          payment_amount: parameters[3],
          remaining_balance: parameters[4],
        }
        this.workingBusiness.payments.push(payment)
        return [{ insertId: payment.payment_id }, []]
      }

      if (normalized.startsWith('INSERT INTO stock_in')) {
        const stockIn = {
          stockin_id: nextStockInId++,
          supplier_id: parameters[0],
          product_id: parameters[1],
          user_id: parameters[2],
          quantity_received: parameters[3],
          remaining_quantity: parameters[4],
          cost_price: parameters[5],
          total_cost: parameters[6],
          delivery_date: parameters[7].toISOString(),
        }
        this.workingBusiness.stockIns.push(stockIn)
        this.workingBusiness.batches.set(stockIn.stockin_id, { ...stockIn })
        return [{ insertId: stockIn.stockin_id }, []]
      }
      if (normalized.startsWith('UPDATE products SET stock_quantity = stock_quantity +')) {
        const product = this.workingBusiness.products.get(parameters[1])
        product.stock_quantity = (Number(product.stock_quantity) + Number(parameters[0])).toFixed(3)
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('UPDATE products SET status')) {
        const product = this.workingBusiness.products.get(parameters[1])
        product.status = parameters[0]
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) return [{ insertId: 1 }, []]

      assert.fail(`Unexpected rollback-test SQL: ${normalized}`)
    },
    async commit() {
      database.business = this.workingBusiness
      database.idempotencyRecords = this.workingIdempotency
      database.commitCount += 1
      if (database.loseCommitAck) {
        database.loseCommitAck = false
        const error = new Error('simulated lost commit acknowledgement after commit')
        error.code = 'ER_TEST_COMMIT_ACK'
        throw error
      }
    },
    async rollback() {
      database.rollbackCount += 1
      this.workingBusiness = null
      this.workingIdempotency = null
    },
    release() { database.releaseCount += 1 },
    destroy() { database.destroyCount += 1 },
  }

  database.getConnection = async () => {
    database.connectionCount += 1
    return connection
  }
  return { database, connection }
}

function request(operation, body) {
  requestId += 1
  const key = `rollback-${operation}-${requestId}`
  return {
    body,
    user: { user_id: 7 },
    get(name) {
      return name.toLowerCase() === 'idempotency-key' ? key : undefined
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

function cents(value) {
  return BigInt(Math.round(Number(value) * 100))
}

function amount(value) {
  const integer = BigInt(value)
  return `${integer / 100n}.${String(integer % 100n).padStart(2, '0')}`
}

async function withFixture(fixture, action) {
  const originalGetConnection = pool.getConnection
  pool.getConnection = fixture.database.getConnection
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    return await action()
  } finally {
    pool.getConnection = originalGetConnection
    console.error = originalConsoleError
  }
}

async function runPayment() {
  const result = response()
  await recordPayment(request('payment', { sale_id: 50, payment_amount: '60.00' }), result)
  return result
}

async function runStockIn() {
  const result = response()
  await createStockIn(request('stock_in', {
    supplier_id: 2,
    product_id: 1,
    quantity_received: '2.000',
    cost_price: '4.00',
    delivery_date: '2026-10-22T10:00',
  }), result)
  return result
}

function snapshot(database) {
  return structuredClone({
    business: database.business,
    idempotencyRecords: database.idempotencyRecords,
  })
}

function assertRolledBack(fixture, before) {
  assert.deepEqual(snapshot(fixture.database), before)
  assert.equal(fixture.database.commitCount, 0)
  assert.equal(fixture.database.rollbackCount, 1)
  assert.equal(fixture.database.releaseCount, 1)
  assert.equal(fixture.database.destroyCount, 0)
}

test('payment insertion failure rolls back sale, customer, payment history, and idempotency state', async () => {
  const fixture = createFixture({ failOnSql: 'INSERT INTO payments' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runPayment(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.deepEqual(fixture.database.business.payments, [])
    assert.equal(fixture.database.business.sales.get(50).amount_paid, '25.50')
    assert.equal(fixture.database.business.customers.get(9).current_balance, '160.00')
    assertRolledBack(fixture, before)
  })
})

test('customer balance update failure rolls back the earlier sale balance update', async () => {
  const fixture = createFixture({ failOnSql: 'UPDATE customers SET current_balance = current_balance -' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runPayment(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.payments.length, 0)
    assert.equal(fixture.database.business.sales.get(50).amount_paid, '25.50')
    assert.equal(fixture.database.business.customers.get(9).current_balance, '160.00')
    assertRolledBack(fixture, before)
  })
})

test('payment activity-log failure rolls back the inserted payment and balance updates', async () => {
  const fixture = createFixture({ failOnSql: 'INSERT INTO activity_logs' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runPayment(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.payments.length, 0)
    assert.equal(fixture.database.business.sales.get(50).amount_paid, '25.50')
    assert.equal(fixture.database.business.customers.get(9).current_balance, '160.00')
    assertRolledBack(fixture, before)
  })
})

test('payment idempotency-response persistence failure rolls back payment and balance changes', async () => {
  const fixture = createFixture({ failOnSql: 'UPDATE idempotency_records' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runPayment(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.payments.length, 0)
    assert.equal(fixture.database.business.sales.get(50).remaining_balance, '160.00')
    assert.equal(fixture.database.business.customers.get(9).current_balance, '160.00')
    assertRolledBack(fixture, before)
  })
})

test('payment transaction-start failure is unknown and discards the connection without release', async () => {
  const fixture = createFixture({ failBegin: true })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runPayment(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.deepEqual(snapshot(fixture.database), before)
    assert.equal(fixture.database.beginCount, 1)
    assert.equal(fixture.database.rollbackCount, 0)
    assert.equal(fixture.database.releaseCount, 0)
    assert.equal(fixture.database.destroyCount, 1)
  })
})

test('payment commit acknowledgement loss remains unknown without claiming rollback', async () => {
  const fixture = createFixture({ loseCommitAck: true })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runPayment(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.code, 'TRANSACTION_OUTCOME_UNKNOWN')
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.sales.get(50).amount_paid, '85.50')
    assert.equal(fixture.database.business.sales.get(50).remaining_balance, '100.00')
    assert.equal(fixture.database.business.customers.get(9).current_balance, '100.00')
    assert.equal(fixture.database.business.payments.length, 1)
    assert.equal(fixture.database.idempotencyRecords.size, 1)
    const stored = [...fixture.database.idempotencyRecords.values()][0]
    assert.equal(stored.response_status, 201)
    assert.equal(fixture.database.commitCount, 1)
    assert.equal(fixture.database.rollbackCount, 0)
    assert.equal(fixture.database.releaseCount, 0)
    assert.equal(fixture.database.destroyCount, 1)
    assert.notDeepEqual(snapshot(fixture.database), before)
  })
})

test('stock-in row insertion failure leaves batch and product inventory unchanged', async () => {
  const fixture = createFixture({ failOnSql: 'INSERT INTO stock_in' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runStockIn(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.stockIns.length, 0)
    assert.equal(fixture.database.business.products.get(1).stock_quantity, '10.000')
    assertRolledBack(fixture, before)
  })
})

test('product quantity update failure rolls back the earlier stock-in batch insert', async () => {
  const fixture = createFixture({ failOnSql: 'UPDATE products SET stock_quantity = stock_quantity +' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runStockIn(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.stockIns.length, 0)
    assert.deepEqual([...fixture.database.business.batches.keys()], [100])
    assert.equal(fixture.database.business.products.get(1).stock_quantity, '10.000')
    assertRolledBack(fixture, before)
  })
})

test('product status update failure rolls back batch and aggregate stock updates', async () => {
  const fixture = createFixture({ failOnSql: 'UPDATE products SET status' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runStockIn(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.stockIns.length, 0)
    assert.equal(fixture.database.business.products.get(1).stock_quantity, '10.000')
    assert.deepEqual([...fixture.database.business.batches.keys()], [100])
    assertRolledBack(fixture, before)
  })
})

test('stock-in activity-log failure rolls back batch and inventory updates', async () => {
  const fixture = createFixture({ failOnSql: 'INSERT INTO activity_logs' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runStockIn(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.stockIns.length, 0)
    assert.equal(fixture.database.business.products.get(1).stock_quantity, '10.000')
    assert.deepEqual([...fixture.database.business.batches.keys()], [100])
    assertRolledBack(fixture, before)
  })
})

test('stock-in idempotency-response persistence failure rolls back batch and inventory changes', async () => {
  const fixture = createFixture({ failOnSql: 'UPDATE idempotency_records' })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runStockIn(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.stockIns.length, 0)
    assert.equal(fixture.database.business.products.get(1).stock_quantity, '10.000')
    assert.deepEqual([...fixture.database.business.batches.keys()], [100])
    assertRolledBack(fixture, before)
  })
})

test('stock-in transaction-start failure is unknown and discards the connection without release', async () => {
  const fixture = createFixture({ failBegin: true })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runStockIn(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.deepEqual(snapshot(fixture.database), before)
    assert.equal(fixture.database.beginCount, 1)
    assert.equal(fixture.database.rollbackCount, 0)
    assert.equal(fixture.database.releaseCount, 0)
    assert.equal(fixture.database.destroyCount, 1)
  })
})

test('stock-in commit acknowledgement loss remains unknown without claiming rollback', async () => {
  const fixture = createFixture({ loseCommitAck: true })
  const before = snapshot(fixture.database)
  await withFixture(fixture, async () => {
    const result = await runStockIn(fixture)
    assert.equal(result.statusCode, 500)
    assert.equal(result.body.code, 'TRANSACTION_OUTCOME_UNKNOWN')
    assert.equal(result.body.transaction_outcome, 'unknown')
    assert.equal(fixture.database.business.products.get(1).stock_quantity, '12.000')
    assert.equal(fixture.database.business.stockIns.length, 1)
    assert.equal(fixture.database.business.batches.get(101).remaining_quantity, '2.000')
    assert.equal(fixture.database.idempotencyRecords.size, 1)
    const stored = [...fixture.database.idempotencyRecords.values()][0]
    assert.equal(stored.response_status, 201)
    assert.equal(fixture.database.commitCount, 1)
    assert.equal(fixture.database.rollbackCount, 0)
    assert.equal(fixture.database.releaseCount, 0)
    assert.equal(fixture.database.destroyCount, 1)
    assert.notDeepEqual(snapshot(fixture.database), before)
  })
})
