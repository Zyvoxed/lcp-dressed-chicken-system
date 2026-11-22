import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { createSale } from '../controllers/salesController.js'

let requestNumber = 0

function request(quantity, amountPaid, productId = 1) {
  requestNumber += 1
  return {
    body: {
      payment_type: 'Cash',
      amount_paid: amountPaid,
      items: [{ product_id: productId, quantity }],
    },
    user: { user_id: 7 },
    get(name) {
      return name.toLowerCase() === 'idempotency-key' ? `fifo-allocation-test-${requestNumber}` : undefined
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

function fifoConnection({ product, batches, failOnBatchUpdate = 0 }) {
  const state = {
    product: { ...product },
    batches: new Map(batches.map((batch) => [batch.stockin_id, { ...batch }])),
    sales: [],
    saleItems: [],
    allocations: [],
    batchUpdates: [],
    productQuery: null,
    allocationQuery: null,
    writeOrder: [],
    committed: false,
    rollbackCount: 0,
    releases: 0,
  }
  let snapshot
  let nextSaleId = 900
  let nextSalesItemId = 1200

  const connection = {
    async beginTransaction() {
      snapshot = {
        product: { ...state.product },
        batches: structuredClone(state.batches),
        sales: structuredClone(state.sales),
        saleItems: structuredClone(state.saleItems),
        allocations: structuredClone(state.allocations),
        batchUpdates: structuredClone(state.batchUpdates),
        writeOrder: [...state.writeOrder],
      }
    },
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('INSERT INTO idempotency_records')) return [{ affectedRows: 1 }, []]
      if (normalized.startsWith('UPDATE idempotency_records')) return [{ affectedRows: 1 }, []]
      if (normalized.startsWith('SELECT product_id, selling_price')) {
        state.productQuery = normalized
        return [state.product.product_id === parameters[0] ? [{ ...state.product }] : [], []]
      }
      if (normalized.startsWith('SELECT stockin_id, remaining_quantity')) {
        state.allocationQuery = normalized
        const eligible = [...state.batches.values()]
          .filter((batch) => batch.product_id === parameters[0] && Number(batch.remaining_quantity) > 0)
          .sort((left, right) => left.delivery_date.localeCompare(right.delivery_date)
            || left.stockin_id - right.stockin_id)
        return [eligible.map((batch) => ({ ...batch })), []]
      }
      if (normalized.startsWith('INSERT INTO sales (')) {
        state.writeOrder.push('sale')
        const sale = {
          sale_id: nextSaleId++,
          total_amount: parameters[3],
          amount_paid: parameters[4],
          remaining_balance: parameters[5],
        }
        state.sales.push(sale)
        return [{ insertId: sale.sale_id }, []]
      }
      if (normalized.startsWith('INSERT INTO sales_items')) {
        state.writeOrder.push('sales_item')
        const item = { salesitem_id: nextSalesItemId++, parameters: [...parameters] }
        state.saleItems.push(item)
        return [{ insertId: item.salesitem_id }, []]
      }
      if (normalized.startsWith('UPDATE stock_in SET remaining_quantity')) {
        state.batchUpdates.push([...parameters])
        if (failOnBatchUpdate && state.batchUpdates.length === failOnBatchUpdate) {
          const error = new Error('simulated batch update failure')
          error.code = 'ER_TEST_FIFO_UPDATE'
          throw error
        }
        state.writeOrder.push(`batch:${parameters[1]}`)
        const batch = state.batches.get(parameters[1])
        batch.remaining_quantity = (Number(batch.remaining_quantity) - Number(parameters[0])).toFixed(3)
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('INSERT INTO sale_batch_allocations')) {
        state.writeOrder.push(`allocation:${parameters[1]}`)
        state.allocations.push([...parameters])
        return [{ insertId: state.allocations.length }, []]
      }
      if (normalized.startsWith('UPDATE products SET stock_quantity = stock_quantity -')) {
        state.writeOrder.push('product_stock')
        state.product.stock_quantity = (Number(state.product.stock_quantity) - Number(parameters[0])).toFixed(3)
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('UPDATE products SET status')) {
        state.writeOrder.push('product_status')
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) return [{ insertId: 1 }, []]
      assert.fail(`Unexpected FIFO test SQL: ${normalized}`)
    },
    async commit() { state.committed = true },
    async rollback() {
      state.rollbackCount += 1
      state.product = snapshot.product
      state.batches = snapshot.batches
      state.sales = snapshot.sales
      state.saleItems = snapshot.saleItems
      state.allocations = snapshot.allocations
      state.writeOrder = snapshot.writeOrder
    },
    release() { state.releases += 1 },
  }
  return { connection, state }
}

async function withConnection(connection, action) {
  const originalGetConnection = pool.getConnection
  pool.getConnection = async () => connection
  try {
    return await action()
  } finally {
    pool.getConnection = originalGetConnection
  }
}

function product(stockQuantity) {
  return {
    product_id: 1,
    selling_price: '200.00',
    stock_quantity: stockQuantity,
    reorder_level: '0.000',
  }
}

function batch(stockinId, deliveryDate, remainingQuantity, costPrice, productId = 1) {
  return {
    stockin_id: stockinId,
    product_id: productId,
    delivery_date: deliveryDate,
    remaining_quantity: remainingQuantity,
    cost_price: costPrice,
  }
}

function assertFifoQuery(state) {
  assert.match(state.productQuery, /WHERE product_id = \? AND is_active = TRUE LIMIT 1 FOR UPDATE$/)
  assert.match(state.allocationQuery, /WHERE product_id = \? AND remaining_quantity > 0/)
  assert.match(state.allocationQuery, /ORDER BY delivery_date ASC, stockin_id ASC FOR UPDATE$/)
}

function remainingById(state) {
  return Object.fromEntries([...state.batches.values()]
    .map((entry) => [entry.stockin_id, entry.remaining_quantity]))
}

function assertAggregateMatchesEligibleBatches(state) {
  const eligibleRemaining = [...state.batches.values()]
    .filter((entry) => entry.product_id === state.product.product_id && Number(entry.remaining_quantity) > 0)
    .reduce((sum, entry) => sum + Number(entry.remaining_quantity), 0)
  assert.equal(Number(state.product.stock_quantity).toFixed(3), eligibleRemaining.toFixed(3))
}

test('allocates oldest batches first across multiple deliveries and preserves source costs', async () => {
  const fixture = fifoConnection({
    product: product('6.000'),
    // Deliberately supplied out of FIFO order so the test checks the controller query ordering.
    batches: [
      batch(30, '2026-03-01 08:00:00', '3.000', '140.00'),
      batch(20, '2026-02-01 08:00:00', '2.000', '120.00'),
      batch(10, '2026-01-01 08:00:00', '1.000', '100.00'),
    ],
  })
  const result = response()
  await withConnection(fixture.connection, () => createSale(request('2.500', '500.00'), result))

  assert.equal(result.statusCode, 201)
  assert.equal(result.body.data.total_amount, '500.00')
  assert.deepEqual(fixture.state.allocations, [
    [1200, 10, '1.000', '100.00'],
    [1200, 20, '1.500', '120.00'],
  ])
  assert.deepEqual(remainingById(fixture.state), { 10: '0.000', 20: '0.500', 30: '3.000' })
  assert.deepEqual(fixture.state.writeOrder.slice(2, 6), [
    'batch:10', 'allocation:10', 'batch:20', 'allocation:20',
  ])
  assertFifoQuery(fixture.state)
  assertAggregateMatchesEligibleBatches(fixture.state)
  assert.equal(fixture.state.product.stock_quantity, '3.500')
  assert.equal(fixture.state.committed, true)
  assert.equal(fixture.state.rollbackCount, 0)
})

test('partial consumption deducts only the requested quantity from the oldest batch', async () => {
  const fixture = fifoConnection({
    product: product('3.000'),
    batches: [
      batch(2, '2026-02-01 08:00:00', '2.000', '120.00'),
      batch(1, '2026-01-01 08:00:00', '1.000', '100.00'),
    ],
  })
  const result = response()
  await withConnection(fixture.connection, () => createSale(request('0.400', '80.00'), result))

  assert.equal(result.statusCode, 201)
  assert.deepEqual(fixture.state.allocations, [[1200, 1, '0.400', '100.00']])
  assert.deepEqual(remainingById(fixture.state), { 1: '0.600', 2: '2.000' })
  assert.equal(fixture.state.product.stock_quantity, '2.600')
  assertAggregateMatchesEligibleBatches(fixture.state)
})

test('exact batch depletion stops without consuming the next eligible batch', async () => {
  const fixture = fifoConnection({
    product: product('3.000'),
    batches: [
      batch(12, '2026-02-01 08:00:00', '2.000', '120.00'),
      batch(11, '2026-01-01 08:00:00', '1.000', '100.00'),
    ],
  })
  const result = response()
  await withConnection(fixture.connection, () => createSale(request('1.000', '200.00'), result))

  assert.equal(result.statusCode, 201)
  assert.deepEqual(fixture.state.allocations, [[1200, 11, '1.000', '100.00']])
  assert.deepEqual(remainingById(fixture.state), { 11: '0.000', 12: '2.000' })
  assert.equal(fixture.state.product.stock_quantity, '2.000')
  assertAggregateMatchesEligibleBatches(fixture.state)
})

test('same-date batches use ascending stockin_id as the tie-breaker', async () => {
  const fixture = fifoConnection({
    product: product('2.000'),
    batches: [
      batch(42, '2026-04-01 08:00:00', '1.000', '125.00'),
      batch(41, '2026-04-01 08:00:00', '1.000', '115.00'),
    ],
  })
  const result = response()
  await withConnection(fixture.connection, () => createSale(request('1.500', '300.00'), result))

  assert.equal(result.statusCode, 201)
  assert.deepEqual(fixture.state.allocations, [
    [1200, 41, '1.000', '115.00'],
    [1200, 42, '0.500', '125.00'],
  ])
  assert.deepEqual(remainingById(fixture.state), { 41: '0.000', 42: '0.500' })
  assertFifoQuery(fixture.state)
  assertAggregateMatchesEligibleBatches(fixture.state)
})

test('insufficient eligible batch quantity rejects without changing aggregate or batch stock', async () => {
  const fixture = fifoConnection({
    // Product aggregate exceeds its eligible batch records; this stale/inconsistent state must not be consumed.
    product: product('5.000'),
    batches: [
      batch(2, '2026-02-01 08:00:00', '2.000', '120.00'),
      batch(1, '2026-01-01 08:00:00', '1.000', '100.00'),
      batch(3, '2026-03-01 08:00:00', '0.000', '140.00'),
    ],
  })
  const result = response()
  await withConnection(fixture.connection, () => createSale(request('3.500', '700.00'), result))

  assert.equal(result.statusCode, 409)
  assert.match(result.body.message, /Available stock records do not cover product 1/)
  assert.deepEqual(remainingById(fixture.state), { 1: '1.000', 2: '2.000', 3: '0.000' })
  assert.equal(fixture.state.product.stock_quantity, '5.000')
  assert.deepEqual(fixture.state.sales, [])
  assert.deepEqual(fixture.state.saleItems, [])
  assert.deepEqual(fixture.state.allocations, [])
  assert.equal(fixture.state.committed, false)
  assert.equal(fixture.state.rollbackCount, 1)
  assert.equal(fixture.state.releases, 1)
  assertFifoQuery(fixture.state)
})

test('failure during a later batch update rolls back earlier allocations and inventory changes', async () => {
  const fixture = fifoConnection({
    product: product('3.000'),
    batches: [
      batch(2, '2026-02-01 08:00:00', '2.000', '120.00'),
      batch(1, '2026-01-01 08:00:00', '1.000', '100.00'),
    ],
    failOnBatchUpdate: 2,
  })
  const result = response()
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    await withConnection(fixture.connection, () => createSale(request('2.500', '500.00'), result))
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(result.statusCode, 500)
  assert.equal(result.body.transaction_outcome, 'unknown')
  assert.equal(fixture.state.committed, false)
  assert.equal(fixture.state.rollbackCount, 1)
  assert.deepEqual(fixture.state.sales, [])
  assert.deepEqual(fixture.state.saleItems, [])
  assert.deepEqual(fixture.state.allocations, [])
  assert.deepEqual(remainingById(fixture.state), { 1: '1.000', 2: '2.000' })
  assert.equal(fixture.state.product.stock_quantity, '3.000')
  assertAggregateMatchesEligibleBatches(fixture.state)
})
