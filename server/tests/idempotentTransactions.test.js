import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import pool from '../config/database.js'
import { getIdempotencyStatus } from '../controllers/idempotencyController.js'
import { recordPayment } from '../controllers/paymentController.js'
import { createSale } from '../controllers/salesController.js'
import { createStockIn } from '../controllers/stockInController.js'

const handlers = {
  sale: createSale,
  stock_in: createStockIn,
  payment: recordPayment,
}

const operationBodies = {
  sale: {
    payment_type: 'Cash',
    amount_paid: '10.00',
    items: [{ product_id: 1, quantity: '1.000' }],
  },
  stock_in: {
    supplier_id: 2,
    product_id: 1,
    quantity_received: '2.000',
    cost_price: '4.00',
    delivery_date: '2026-10-22T10:00',
  },
  payment: {
    sale_id: 50,
    payment_amount: '20.00',
  },
}

const failurePrefixes = {
  sale: 'INSERT INTO sale_batch_allocations',
  stock_in: 'UPDATE products SET stock_quantity = stock_quantity +',
  payment: 'INSERT INTO payments',
}

const unrelatedDuplicatePrefixes = {
  sale: 'INSERT INTO sale_batch_allocations',
  stock_in: 'INSERT INTO stock_in',
  payment: 'INSERT INTO payments',
}

function scopeKey(userId, operation, key) {
  return JSON.stringify([userId, operation, key])
}

function duplicateKeyError(indexName = 'uq_idempotency_user_operation_key') {
  const error = new Error(`Duplicate entry for key '${indexName}'`)
  error.code = 'ER_DUP_ENTRY'
  error.sqlMessage = error.message
  return error
}

function initialBusinessState() {
  return {
    products: new Map([[1, {
      product_id: 1,
      selling_price: '10.00',
      stock_quantity: '10.000',
      reorder_level: '1.000',
      is_active: 1,
    }]]),
    batches: new Map([[100, {
      stockin_id: 100,
      product_id: 1,
      remaining_quantity: '10.000',
      cost_price: '6.00',
      delivery_date: '2026-01-01 08:00:00',
    }]]),
    suppliers: new Map([[2, { supplier_id: 2, is_active: 1 }]]),
    customers: new Map([[9, { customer_id: 9, current_balance: '100.00', is_active: 1 }]]),
    sales: new Map([[50, {
      sale_id: 50,
      customer_id: 9,
      payment_type: 'Credit',
      total_amount: '100.00',
      amount_paid: '0.00',
      remaining_balance: '100.00',
      status: 'Unpaid',
    }]]),
    saleItems: [],
    stockIns: [],
    allocations: [],
    payments: [],
  }
}

class FakeIdempotencyDatabase {
  constructor() {
    this.business = initialBusinessState()
    this.records = new Map()
    this.pendingReservations = new Map()
    this.failOnBusinessSql = null
    this.duplicateOnBusinessSql = null
    this.loseCommitAckFor = null
    this.hideIdempotencyResult = false
    this.returnIncompleteIdempotencyResult = false
    this.idempotencyResultLookups = 0
    this.connectionCount = 0
    this.commitCount = 0
    this.rollbackCount = 0
    this.destroyCount = 0
    this.releaseCount = 0
    this.nextSaleId = 900
    this.nextSalesItemId = 1200
    this.nextStockInId = 1500
    this.nextPaymentId = 1800
  }

  async getConnection() {
    this.connectionCount += 1
    return new FakeIdempotencyConnection(this)
  }

  async execute(sql, parameters = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized.startsWith('SELECT request_hash')) {
      this.idempotencyResultLookups += 1
      if (this.hideIdempotencyResult) return [[], []]
      const record = this.records.get(scopeKey(parameters[0], parameters[1], parameters[2]))
      return [record ? [{
        request_hash: Buffer.from(record.request_hash),
        response_status: this.returnIncompleteIdempotencyResult ? null : record.response_status,
        response_body: this.returnIncompleteIdempotencyResult ? null : record.response_body,
      }] : [], []]
    }
    if (normalized.startsWith('SELECT response_status')) {
      const record = this.records.get(scopeKey(parameters[0], parameters[1], parameters[2]))
      return [record ? [{
        response_status: record.response_status,
        response_body: record.response_body,
      }] : [], []]
    }
    assert.fail(`Unexpected idempotency lookup SQL: ${normalized}`)
  }

  async reserve(connection, [userId, operation, key, requestHash]) {
    const recordScope = scopeKey(userId, operation, key)
    while (true) {
      if (this.records.has(recordScope)) throw duplicateKeyError()

      const pending = this.pendingReservations.get(recordScope)
      if (pending) {
        await pending.finished
        continue
      }

      let finishReservation
      const finished = new Promise((resolve) => { finishReservation = resolve })
      this.pendingReservations.set(recordScope, { finished, finishReservation })
      connection.reservationScope = recordScope
      connection.idempotencyRecord = {
        user_id: userId,
        operation_type: operation,
        idempotency_key: key,
        request_hash: Buffer.from(requestHash),
        response_status: null,
        response_body: null,
      }
      return
    }
  }

  finishReservation(connection, committed) {
    if (!connection.reservationScope) return
    const pending = this.pendingReservations.get(connection.reservationScope)
    if (committed && connection.idempotencyRecord) {
      this.records.set(connection.reservationScope, connection.idempotencyRecord)
    }
    if (pending) {
      this.pendingReservations.delete(connection.reservationScope)
      pending.finishReservation()
    }
    connection.reservationScope = null
  }
}

class FakeIdempotencyConnection {
  constructor(database) {
    this.database = database
    this.working = null
    this.reservationScope = null
    this.idempotencyRecord = null
    this.released = false
    this.destroyed = false
  }

  async beginTransaction() {
    this.working = structuredClone(this.database.business)
  }

  async execute(sql, parameters = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized.startsWith('INSERT INTO idempotency_records')) {
      await this.database.reserve(this, parameters)
      return [{ affectedRows: 1 }, []]
    }
    if (normalized.startsWith('UPDATE idempotency_records')) {
      if (!this.idempotencyRecord) assert.fail('Response update requires an idempotency reservation')
      this.idempotencyRecord.response_status = parameters[0]
      this.idempotencyRecord.response_body = parameters[1]
      return [{ affectedRows: 1 }, []]
    }

    if (normalized.startsWith('SELECT customer_id FROM customers')) {
      const customer = this.working.customers.get(parameters[0])
      return [customer?.is_active ? [{ customer_id: customer.customer_id }] : [], []]
    }
    if (normalized.startsWith('SELECT supplier_id FROM suppliers')) {
      const supplier = this.working.suppliers.get(parameters[0])
      return [supplier?.is_active ? [{ supplier_id: supplier.supplier_id }] : [], []]
    }
    if (normalized.startsWith('SELECT product_id, selling_price')) {
      const product = this.working.products.get(parameters[0])
      return [product?.is_active ? [{ ...product }] : [], []]
    }
    if (normalized.startsWith('SELECT product_id, stock_quantity')) {
      const product = this.working.products.get(parameters[0])
      return [product?.is_active ? [{ ...product }] : [], []]
    }
    if (normalized.startsWith('SELECT stockin_id, remaining_quantity')) {
      const batches = [...this.working.batches.values()]
        .filter((batch) => batch.product_id === parameters[0] && Number(batch.remaining_quantity) > 0)
        .sort((left, right) => left.delivery_date.localeCompare(right.delivery_date)
          || left.stockin_id - right.stockin_id)
      return [batches.map((batch) => ({ ...batch })), []]
    }
    if (normalized.startsWith('SELECT customer_id, payment_type')) {
      const sale = this.working.sales.get(parameters[0])
      return [sale ? [{ ...sale }] : [], []]
    }
    if (normalized.startsWith('SELECT current_balance')) {
      const customer = this.working.customers.get(parameters[0])
      return [customer ? [{ current_balance: customer.current_balance }] : [], []]
    }

    if (normalized.startsWith('INSERT INTO sales (')) {
      this.failIfConfigured(normalized)
      const sale = {
        sale_id: this.database.nextSaleId++,
        customer_id: parameters[0],
        payment_type: parameters[2],
        total_amount: parameters[3],
        amount_paid: parameters[4],
        remaining_balance: parameters[5],
        status: parameters[6],
      }
      this.working.sales.set(sale.sale_id, sale)
      return [{ insertId: sale.sale_id }, []]
    }
    if (normalized.startsWith('INSERT INTO sales_items')) {
      this.failIfConfigured(normalized)
      const item = { salesitem_id: this.database.nextSalesItemId++, parameters: [...parameters] }
      this.working.saleItems.push(item)
      return [{ insertId: item.salesitem_id }, []]
    }
    if (normalized.startsWith('UPDATE stock_in SET remaining_quantity')) {
      this.failIfConfigured(normalized)
      const batch = this.working.batches.get(parameters[1])
      batch.remaining_quantity = (Number(batch.remaining_quantity) - Number(parameters[0])).toFixed(3)
      return [{ affectedRows: 1 }, []]
    }
    if (normalized.startsWith('INSERT INTO sale_batch_allocations')) {
      this.failIfConfigured(normalized)
      this.working.allocations.push([...parameters])
      return [{ insertId: this.working.allocations.length }, []]
    }
    if (normalized.startsWith('UPDATE products SET stock_quantity = stock_quantity -')) {
      this.failIfConfigured(normalized)
      const product = this.working.products.get(parameters[1])
      product.stock_quantity = (Number(product.stock_quantity) - Number(parameters[0])).toFixed(3)
      return [{ affectedRows: 1 }, []]
    }
    if (normalized.startsWith('UPDATE products SET stock_quantity = stock_quantity +')) {
      this.failIfConfigured(normalized)
      const product = this.working.products.get(parameters[1])
      product.stock_quantity = (Number(product.stock_quantity) + Number(parameters[0])).toFixed(3)
      return [{ affectedRows: 1 }, []]
    }
    if (normalized.startsWith('UPDATE products SET status')) return [{ affectedRows: 1 }, []]
    if (normalized.startsWith('INSERT INTO stock_in')) {
      this.failIfConfigured(normalized)
      const stockIn = {
        stockin_id: this.database.nextStockInId++,
        supplier_id: parameters[0],
        product_id: parameters[1],
        quantity_received: parameters[3],
        remaining_quantity: parameters[4],
        cost_price: parameters[5],
      }
      this.working.stockIns.push(stockIn)
      this.working.batches.set(stockIn.stockin_id, {
        ...stockIn,
        delivery_date: parameters[7].toISOString(),
      })
      return [{ insertId: stockIn.stockin_id }, []]
    }
    if (normalized.startsWith('UPDATE customers SET current_balance = current_balance +')) {
      this.failIfConfigured(normalized)
      const customer = this.working.customers.get(parameters[1])
      customer.current_balance = centsAmount(cents(customer.current_balance) + cents(parameters[0]))
      return [{ affectedRows: 1 }, []]
    }
    if (normalized.startsWith('UPDATE sales SET amount_paid')) {
      this.failIfConfigured(normalized)
      const sale = this.working.sales.get(parameters[3])
      Object.assign(sale, {
        amount_paid: parameters[0],
        remaining_balance: parameters[1],
        status: parameters[2],
      })
      return [{ affectedRows: 1 }, []]
    }
    if (normalized.startsWith('UPDATE customers SET current_balance = current_balance -')) {
      this.failIfConfigured(normalized)
      const customer = this.working.customers.get(parameters[1])
      customer.current_balance = centsAmount(cents(customer.current_balance) - cents(parameters[0]))
      return [{ affectedRows: 1 }, []]
    }
    if (normalized.startsWith('INSERT INTO payments')) {
      this.failIfConfigured(normalized)
      const payment = {
        payment_id: this.database.nextPaymentId++,
        sale_id: parameters[0],
        customer_id: parameters[1],
        payment_amount: parameters[3],
        remaining_balance: parameters[4],
      }
      this.working.payments.push(payment)
      return [{ insertId: payment.payment_id }, []]
    }
    if (normalized.startsWith('INSERT INTO activity_logs')) return [{ insertId: 1 }, []]
    assert.fail(`Unexpected transaction SQL in fake database: ${normalized}`)
  }

  failIfConfigured(sql) {
    if (this.database.duplicateOnBusinessSql && sql.startsWith(this.database.duplicateOnBusinessSql)) {
      const duplicateIndex = 'uq_unrelated_business_constraint'
      this.database.duplicateOnBusinessSql = null
      throw duplicateKeyError(duplicateIndex)
    }
    if (this.database.failOnBusinessSql && sql.startsWith(this.database.failOnBusinessSql)) {
      const failingSql = this.database.failOnBusinessSql
      this.database.failOnBusinessSql = null
      const error = new Error(`simulated pre-commit failure: ${failingSql}`)
      error.code = 'ER_TEST_TRANSACTION_WRITE'
      throw error
    }
  }

  async commit() {
    this.database.business = this.working
    this.database.finishReservation(this, true)
    this.database.commitCount += 1
    if (this.database.loseCommitAckFor === this.idempotencyRecord?.operation_type) {
      this.database.loseCommitAckFor = null
      const error = new Error('simulated lost commit acknowledgement')
      error.code = 'ER_TEST_COMMIT_ACK'
      throw error
    }
  }

  async rollback() {
    this.database.rollbackCount += 1
    this.database.finishReservation(this, false)
    this.working = null
  }

  release() {
    this.released = true
    this.database.releaseCount += 1
  }

  destroy() {
    this.destroyed = true
    this.database.destroyCount += 1
  }
}

function cents(value) {
  return BigInt(Math.round(Number(value) * 100))
}

function centsAmount(value) {
  const centsValue = BigInt(value)
  return `${centsValue / 100n}.${String(centsValue % 100n).padStart(2, '0')}`
}

function makeRequest(operation, { key = 'shared-idempotency-key', userId = 7, body = operationBodies[operation] } = {}) {
  return {
    body: structuredClone(body),
    user: { user_id: userId, role: 'Admin' },
    params: { operation, key },
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

async function invoke(operation, options = {}) {
  const result = response()
  await handlers[operation](makeRequest(operation, options), result)
  return result
}

async function invokeStatus(operation, key, userId = 7) {
  const result = response()
  await getIdempotencyStatus(makeRequest(operation, { key, userId }), result)
  return result
}

async function withFakeDatabase(database, action) {
  const originalGetConnection = pool.getConnection
  const originalExecute = pool.execute
  pool.getConnection = () => database.getConnection()
  pool.execute = (sql, parameters) => database.execute(sql, parameters)
  try {
    return await action()
  } finally {
    pool.getConnection = originalGetConnection
    pool.execute = originalExecute
  }
}

function businessSnapshot(database) {
  return structuredClone(database.business)
}

function operationCounts(database) {
  return {
    sales: database.business.sales.size - 1,
    stockIns: database.business.stockIns.length,
    payments: database.business.payments.length,
    allocations: database.business.allocations.length,
    productStock: database.business.products.get(1).stock_quantity,
    sourceBatch: database.business.batches.get(100).remaining_quantity,
    customerBalance: database.business.customers.get(9).current_balance,
    creditSale: { ...database.business.sales.get(50) },
  }
}

function changedBody(operation) {
  if (operation === 'sale') {
    return { ...operationBodies.sale, items: [{ product_id: 1, quantity: '2.000' }], amount_paid: '20.00' }
  }
  if (operation === 'stock_in') return { ...operationBodies.stock_in, quantity_received: '3.000' }
  return { ...operationBodies.payment, payment_amount: '30.00' }
}

function equivalentBody(operation) {
  if (operation === 'sale') {
    return { ...operationBodies.sale, amount_paid: '10.0', items: [{ product_id: 1, quantity: '1.0' }] }
  }
  if (operation === 'stock_in') {
    return { ...operationBodies.stock_in, quantity_received: '2.0', cost_price: '4.0' }
  }
  return { ...operationBodies.payment, payment_amount: '20.0' }
}

test('the database schema scopes unique idempotency keys by user and operation', async () => {
  const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8')
  assert.match(schema, /UNIQUE KEY uq_idempotency_user_operation_key\s*\(user_id, operation_type, idempotency_key\)/)
})

for (const operation of Object.keys(handlers)) {
  test(`same-key same-payload retry replays original ${operation} response`, async () => {
    const database = new FakeIdempotencyDatabase()
    await withFakeDatabase(database, async () => {
      const first = await invoke(operation, { key: `replay-${operation}` })
      const afterFirst = operationCounts(database)
      const recordCount = database.records.size
      const retry = await invoke(operation, {
        key: `replay-${operation}`,
        body: equivalentBody(operation),
      })

      assert.equal(first.statusCode, 201, operation)
      assert.deepEqual(operationCounts(database), afterFirst, operation)
      assert.equal(database.records.size, recordCount)
      assert.equal(database.commitCount, 1, operation)
      assert.equal(database.rollbackCount, 1, operation)
      assert.equal(retry.statusCode, 201, `${operation} retry should replay the original response`)
      assert.deepEqual(retry.body, first.body, operation)
    })
  })
}

for (const operation of Object.keys(handlers)) {
  test(`same-key different-payload ${operation} retry returns conflict`, async () => {
    const database = new FakeIdempotencyDatabase()
    await withFakeDatabase(database, async () => {
      const first = await invoke(operation, { key: `conflict-${operation}` })
      const afterFirst = operationCounts(database)
      const retry = await invoke(operation, {
        key: `conflict-${operation}`,
        body: changedBody(operation),
      })

      assert.equal(first.statusCode, 201, operation)
      assert.deepEqual(operationCounts(database), afterFirst, operation)
      assert.equal(database.records.size, 1, operation)
      assert.equal(database.commitCount, 1, operation)
      assert.equal(retry.statusCode, 409, `${operation} conflict should return HTTP 409`)
      assert.equal(retry.body.code, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', operation)
      assert.equal(retry.body.transaction_outcome, 'not_committed', operation)
    })
  })
}

test('same key in another user or operation scope creates independent records', async () => {
  const database = new FakeIdempotencyDatabase()
  await withFakeDatabase(database, async () => {
    const firstSale = await invoke('sale', { key: 'cross-scope-key', userId: 7 })
    const otherUserSale = await invoke('sale', { key: 'cross-scope-key', userId: 8 })
    const stockIn = await invoke('stock_in', { key: 'cross-scope-key', userId: 7 })
    const payment = await invoke('payment', { key: 'cross-scope-key', userId: 7 })

    assert.equal(firstSale.statusCode, 201)
    assert.equal(otherUserSale.statusCode, 201)
    assert.equal(stockIn.statusCode, 201)
    assert.equal(payment.statusCode, 201)
    assert.equal(database.records.size, 4)
    assert.deepEqual([...database.records.values()].map((record) => [record.user_id, record.operation_type]).sort(), [
      [7, 'payment'], [7, 'sale'], [7, 'stock_in'], [8, 'sale'],
    ])
    assert.equal(operationCounts(database).sales, 2, 'same key under a different user is a separate scope')
    assert.equal(operationCounts(database).stockIns, 1, 'same key under a different operation is a separate scope')
    assert.equal(operationCounts(database).payments, 1)
  })
})

for (const operation of Object.keys(handlers)) {
  test(`invalid and missing ${operation} idempotency keys are rejected before connecting`, async () => {
    const database = new FakeIdempotencyDatabase()
    await withFakeDatabase(database, async () => {
      for (const key of [null, 'bad key']) {
        const result = await invoke(operation, { key })
        assert.equal(result.statusCode, 400, `${operation}: ${String(key)}`)
      }
      assert.equal(database.connectionCount, 0, operation)
      assert.equal(database.records.size, 0, operation)
    })
  })
}

for (const operation of Object.keys(handlers)) {
  test(`concurrent same-scope ${operation} submissions commit one business transaction`, async () => {
    const database = new FakeIdempotencyDatabase()
    await withFakeDatabase(database, async () => {
      const options = { key: `concurrent-${operation}` }
      const [first, second] = await Promise.all([
        invoke(operation, options),
        invoke(operation, options),
      ])

      assert.equal(database.records.size, 1, operation)
      assert.equal(database.commitCount, 1, operation)
      assert.equal(database.rollbackCount, 1, operation)
      const counts = operationCounts(database)
      assert.equal(counts.sales, operation === 'sale' ? 1 : 0, operation)
      assert.equal(counts.stockIns, operation === 'stock_in' ? 1 : 0, operation)
      assert.equal(counts.payments, operation === 'payment' ? 1 : 0, operation)
      assert.equal(first.statusCode, 201, operation)
      assert.equal(second.statusCode, 201, `${operation} duplicate should replay the response`)
      assert.deepEqual(second.body, first.body, operation)
    })
  })
}

for (const operation of Object.keys(handlers)) {
  test(`pre-commit ${operation} failure leaves no completed record and permits retry`, async () => {
    const database = new FakeIdempotencyDatabase()
    database.failOnBusinessSql = failurePrefixes[operation]
    const before = businessSnapshot(database)
    await withFakeDatabase(database, async () => {
      const failed = await invoke(operation, { key: `precommit-${operation}` })
      assert.equal(failed.statusCode, 500, operation)
      assert.equal(failed.body.transaction_outcome, 'unknown', operation)
      assert.equal(database.rollbackCount, 1, operation)
      assert.equal(database.records.size, 0, operation)
      assert.deepEqual(database.business, before, operation)

      const status = await invokeStatus(operation, `precommit-${operation}`)
      assert.equal(status.statusCode, 200, operation)
      assert.equal(status.body.data.state, 'not_found', operation)

      const retry = await invoke(operation, { key: `precommit-${operation}` })
      assert.equal(retry.statusCode, 201, operation)
      assert.equal(database.records.size, 1, operation)
      assert.equal(database.commitCount, 1, operation)
      const counts = operationCounts(database)
      assert.equal(counts.sales, operation === 'sale' ? 1 : 0, operation)
      assert.equal(counts.stockIns, operation === 'stock_in' ? 1 : 0, operation)
      assert.equal(counts.payments, operation === 'payment' ? 1 : 0, operation)
    })
  })
}

for (const operation of Object.keys(handlers)) {
  test(`lost ${operation} commit acknowledgement can be recovered by status and retry`, async () => {
    const database = new FakeIdempotencyDatabase()
    database.loseCommitAckFor = operation
    await withFakeDatabase(database, async () => {
      const key = `lost-ack-${operation}`
      const unknown = await invoke(operation, { key })
      const committedCounts = operationCounts(database)

      assert.equal(unknown.statusCode, 500, operation)
      assert.equal(unknown.body.code, 'TRANSACTION_OUTCOME_UNKNOWN', operation)
      assert.equal(unknown.body.transaction_outcome, 'unknown', operation)
      assert.equal(database.commitCount, 1, operation)
      assert.equal(database.destroyCount, 1, operation)
      assert.equal(database.releaseCount, 0, operation)

      const status = await invokeStatus(operation, key)
      assert.equal(status.statusCode, 200, operation)
      assert.equal(status.body.data.state, 'completed', operation)

      const retry = await invoke(operation, { key })
      assert.deepEqual(operationCounts(database), committedCounts, operation)
      assert.equal(database.records.size, 1, operation)
      assert.equal(database.commitCount, 1, operation)
      assert.equal(retry.statusCode, 201, `${operation} retry should replay the committed result`)
      assert.deepEqual(retry.body, status.body.data.response, operation)
    })
  })
}

for (const operation of Object.keys(handlers)) {
  test(`unrelated ${operation} duplicate-key errors remain unknown and are not replayed`, async () => {
    const database = new FakeIdempotencyDatabase()
    database.duplicateOnBusinessSql = unrelatedDuplicatePrefixes[operation]
    const before = businessSnapshot(database)
    await withFakeDatabase(database, async () => {
      const result = await invoke(operation, { key: `unrelated-duplicate-${operation}` })

      assert.equal(result.statusCode, 500, operation)
      assert.equal(result.body.code, 'TRANSACTION_OUTCOME_UNKNOWN', operation)
      assert.equal(result.body.transaction_outcome, 'unknown', operation)
      assert.equal(database.rollbackCount, 1, operation)
      assert.equal(database.records.size, 0, operation)
      assert.equal(database.idempotencyResultLookups, 0, operation)
      assert.deepEqual(database.business, before, operation)
    })
  })
}

for (const operation of Object.keys(handlers)) {
  for (const lookupState of ['missing', 'incomplete']) {
    test(`${operation} duplicate with ${lookupState} stored result remains unknown`, async () => {
      const database = new FakeIdempotencyDatabase()
      const key = `unverified-${lookupState}-${operation}`
      await withFakeDatabase(database, async () => {
        const first = await invoke(operation, { key })
        const afterCommit = operationCounts(database)
        assert.equal(first.statusCode, 201, operation)

        database.hideIdempotencyResult = lookupState === 'missing'
        database.returnIncompleteIdempotencyResult = lookupState === 'incomplete'
        const retry = await invoke(operation, {
          key,
          body: lookupState === 'incomplete' ? changedBody(operation) : operationBodies[operation],
        })

        assert.equal(retry.statusCode, 500, operation)
        assert.equal(retry.body.code, 'TRANSACTION_OUTCOME_UNKNOWN', operation)
        assert.equal(retry.body.transaction_outcome, 'unknown', operation)
        assert.deepEqual(operationCounts(database), afterCommit, operation)
        assert.equal(database.records.size, 1, operation)
        assert.equal(database.idempotencyResultLookups, 1, operation)
        assert.equal(database.commitCount, 1, operation)
      })
    })
  }
}
