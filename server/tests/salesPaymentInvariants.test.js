import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { recordPayment } from '../controllers/paymentController.js'
import { createSale } from '../controllers/salesController.js'
import { centsToAmount, toCents } from '../utils/money.js'

let requestNumber = 0

function request(body) {
  requestNumber += 1
  return {
    body,
    user: { user_id: 7 },
    get(name) {
      return name.toLowerCase() === 'idempotency-key' ? `sales-payment-invariant-${requestNumber}` : undefined
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

function saleConnection({
  products = [{ product_id: 1, selling_price: '185.50', stock_quantity: '10.000', reorder_level: '1.000' }],
  batches,
  customerExists = true,
  customerBalance = '10.00',
} = {}) {
  const productRows = new Map(products.map((product) => [product.product_id, { ...product }]))
  const batchRows = new Map((batches || products.map((product, index) => ({
    stockin_id: index + 1,
    product_id: product.product_id,
    remaining_quantity: '10.000',
    cost_price: '150.00',
    delivery_date: '2026-01-01',
  }))).map((batch) => [batch.stockin_id, { ...batch }]))
  const state = {
    productRows,
    batchRows,
    customerExists,
    customerBalance,
    sales: [],
    saleItems: [],
    allocations: [],
    businessWrites: [],
    committed: false,
    rolledBack: false,
    releases: 0,
  }
  let snapshot
  let nextSaleId = 100
  let nextItemId = 200

  const connection = {
    async beginTransaction() {
      snapshot = {
        productRows: structuredClone(state.productRows),
        batchRows: structuredClone(state.batchRows),
        customerBalance: state.customerBalance,
        sales: structuredClone(state.sales),
        saleItems: structuredClone(state.saleItems),
        allocations: structuredClone(state.allocations),
      }
    },
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('INSERT INTO idempotency_records')) return [{ affectedRows: 1 }, []]
      if (normalized.startsWith('UPDATE idempotency_records')) return [{ affectedRows: 1 }, []]
      if (normalized.startsWith('SELECT customer_id FROM customers')) {
        return [state.customerExists ? [{ customer_id: parameters[0] }] : [], []]
      }
      if (normalized.startsWith('SELECT product_id, selling_price')) {
        const product = state.productRows.get(parameters[0])
        return [product ? [{ ...product }] : [], []]
      }
      if (normalized.startsWith('SELECT stockin_id, remaining_quantity')) {
        const batchesForProduct = [...state.batchRows.values()]
          .filter((batch) => batch.product_id === parameters[0] && Number(batch.remaining_quantity) > 0)
        return [batchesForProduct.map((batch) => ({ ...batch })), []]
      }
      if (normalized.startsWith('INSERT INTO sales (')) {
        state.businessWrites.push(normalized)
        const sale = {
          sale_id: nextSaleId++,
          customer_id: parameters[0],
          payment_type: parameters[2],
          total_amount: parameters[3],
          amount_paid: parameters[4],
          remaining_balance: parameters[5],
          status: parameters[6],
        }
        state.sales.push(sale)
        return [{ insertId: sale.sale_id }, []]
      }
      if (normalized.startsWith('INSERT INTO sales_items')) {
        state.businessWrites.push(normalized)
        const item = { salesitem_id: nextItemId++, parameters: [...parameters] }
        state.saleItems.push(item)
        return [{ insertId: item.salesitem_id }, []]
      }
      if (normalized.startsWith('UPDATE stock_in SET remaining_quantity')) {
        state.businessWrites.push(normalized)
        const batch = state.batchRows.get(parameters[1])
        batch.remaining_quantity = (Number(batch.remaining_quantity) - Number(parameters[0])).toFixed(3)
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('INSERT INTO sale_batch_allocations')) {
        state.businessWrites.push(normalized)
        state.allocations.push([...parameters])
        return [{ insertId: state.allocations.length }, []]
      }
      if (normalized.startsWith('UPDATE products SET stock_quantity = stock_quantity -')) {
        state.businessWrites.push(normalized)
        const product = state.productRows.get(parameters[1])
        product.stock_quantity = (Number(product.stock_quantity) - Number(parameters[0])).toFixed(3)
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('UPDATE products SET status')) {
        state.businessWrites.push(normalized)
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('UPDATE customers SET current_balance = current_balance +')) {
        state.businessWrites.push(normalized)
        state.customerBalance = centsToAmount(toCents(state.customerBalance) + toCents(parameters[0]))
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) {
        state.businessWrites.push(normalized)
        return [{ insertId: 1 }, []]
      }
      assert.fail(`Unexpected sale SQL in test fixture: ${normalized}`)
    },
    async commit() { state.committed = true },
    async rollback() {
      state.rolledBack = true
      state.productRows = snapshot.productRows
      state.batchRows = snapshot.batchRows
      state.customerBalance = snapshot.customerBalance
      state.sales = snapshot.sales
      state.saleItems = snapshot.saleItems
      state.allocations = snapshot.allocations
    },
    release() { state.releases += 1 },
  }
  return { connection, state }
}

function paymentConnection({ sale, customerBalance, failPaymentInsert = false }) {
  const state = {
    sale: { ...sale },
    customerBalance,
    payments: [],
    committed: false,
    rolledBack: false,
    releases: 0,
  }
  let snapshot
  const connection = {
    async beginTransaction() {
      snapshot = {
        sale: { ...state.sale },
        customerBalance: state.customerBalance,
        payments: structuredClone(state.payments),
      }
    },
    async execute(sql, parameters = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('INSERT INTO idempotency_records')) return [{ affectedRows: 1 }, []]
      if (normalized.startsWith('UPDATE idempotency_records')) return [{ affectedRows: 1 }, []]
      if (normalized.startsWith('SELECT customer_id, payment_type')) {
        return [[{ ...state.sale }], []]
      }
      if (normalized.startsWith('SELECT current_balance')) {
        return [[{ current_balance: state.customerBalance }], []]
      }
      if (normalized.startsWith('UPDATE sales SET amount_paid')) {
        state.sale = {
          ...state.sale,
          amount_paid: parameters[0],
          remaining_balance: parameters[1],
          status: parameters[2],
        }
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('UPDATE customers SET current_balance = current_balance -')) {
        state.customerBalance = centsToAmount(toCents(state.customerBalance) - toCents(parameters[0]))
        return [{ affectedRows: 1 }, []]
      }
      if (normalized.startsWith('INSERT INTO payments')) {
        if (failPaymentInsert) throw new Error('simulated payment insert failure')
        state.payments.push([...parameters])
        return [{ insertId: 401 }, []]
      }
      if (normalized.startsWith('INSERT INTO activity_logs')) return [{ insertId: 1 }, []]
      assert.fail(`Unexpected payment SQL in test fixture: ${normalized}`)
    },
    async commit() { state.committed = true },
    async rollback() {
      state.rolledBack = true
      state.sale = snapshot.sale
      state.customerBalance = snapshot.customerBalance
      state.payments = snapshot.payments
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

test('cash sale records the sale total, not tender, and exact cash settles with no balance', async () => {
  const { connection, state } = saleConnection()
  const result = response()
  await withConnection(connection, () => createSale(request({
    payment_type: 'Cash',
    amount_paid: '185.50',
    items: [{ product_id: 1, quantity: '1.000' }],
  }), result))

  assert.equal(result.statusCode, 201)
  assert.deepEqual(result.body.data, {
    sale_id: 100,
    total_amount: '185.50',
    amount_paid: '185.50',
    remaining_balance: '0.00',
    status: 'Paid',
  })
  assert.equal(state.sales[0].amount_paid, state.sales[0].total_amount)
  assert.equal(state.sales[0].status, 'Paid')
  assert.equal(state.committed, true)
  assert.equal(state.rolledBack, false)
})

test('credit sales handle zero, partial, and full initial deposits with reconciled customer balances', async () => {
  const cases = [
    { deposit: '0.00', remaining: '185.50', status: 'Unpaid', balance: '195.50' },
    { deposit: '25.50', remaining: '160.00', status: 'Partially Paid', balance: '170.00' },
    { deposit: '185.50', remaining: '0.00', status: 'Paid', balance: '10.00' },
  ]

  for (const expected of cases) {
    const { connection, state } = saleConnection()
    const result = response()
    await withConnection(connection, () => createSale(request({
      payment_type: 'Credit',
      customer_id: 9,
      amount_paid: expected.deposit,
      items: [{ product_id: 1, quantity: '1.000' }],
    }), result))

    assert.equal(result.statusCode, 201)
    assert.equal(result.body.data.total_amount, '185.50')
    assert.equal(result.body.data.amount_paid, expected.deposit)
    assert.equal(result.body.data.remaining_balance, expected.remaining)
    assert.equal(result.body.data.status, expected.status)
    assert.equal(state.sales[0].remaining_balance, expected.remaining)
    assert.equal(state.customerBalance, expected.balance)
    assert.equal(state.committed, true)
  }
})

test('credit sale rounds each line to cents before summing multiple items', async () => {
  const { connection, state } = saleConnection({
    products: [
      { product_id: 1, selling_price: '0.05', stock_quantity: '1.000', reorder_level: '0.000' },
      { product_id: 2, selling_price: '0.05', stock_quantity: '1.000', reorder_level: '0.000' },
    ],
  })
  const result = response()
  await withConnection(connection, () => createSale(request({
    payment_type: 'Credit',
    customer_id: 9,
    amount_paid: '0.01',
    items: [
      { product_id: 1, quantity: '0.300' },
      { product_id: 2, quantity: '0.300' },
    ],
  }), result))

  assert.equal(result.statusCode, 201)
  assert.equal(result.body.data.total_amount, '0.04')
  assert.equal(result.body.data.amount_paid, '0.01')
  assert.equal(result.body.data.remaining_balance, '0.03')
  assert.equal(state.customerBalance, '10.03')
})

test('sale rejects missing credit customer, invalid deposits, cash underpayment, and deposit above total', async () => {
  const invalidCases = [
    { payment_type: 'Credit', amount_paid: '0.00', items: [{ product_id: 1, quantity: '1.000' }] },
    { payment_type: 'Credit', customer_id: 9, amount_paid: '-0.01', items: [{ product_id: 1, quantity: '1.000' }] },
    { payment_type: 'Credit', customer_id: 9, amount_paid: 'NaN', items: [{ product_id: 1, quantity: '1.000' }] },
    { payment_type: 'Credit', customer_id: 9, amount_paid: 'Infinity', items: [{ product_id: 1, quantity: '1.000' }] },
    { payment_type: 'Credit', customer_id: 9, amount_paid: '1.001', items: [{ product_id: 1, quantity: '1.000' }] },
    { payment_type: 'Credit', customer_id: 9, amount_paid: '185.51', items: [{ product_id: 1, quantity: '1.000' }] },
    { payment_type: 'Cash', amount_paid: '185.49', items: [{ product_id: 1, quantity: '1.000' }] },
  ]

  for (const body of invalidCases) {
    const { connection, state } = saleConnection()
    const result = response()
    await withConnection(connection, () => createSale(request(body), result))
    assert.equal(result.statusCode, 400, JSON.stringify(body))
    assert.equal(state.sales.length, 0)
    assert.equal(state.saleItems.length, 0)
    assert.equal(state.allocations.length, 0)
    assert.equal(state.businessWrites.length, 0)
    assert.equal(state.committed, false)
    const rejectedInsideTransaction = body.payment_type === 'Cash' || body.amount_paid === '185.51'
    assert.equal(state.rolledBack, rejectedInsideTransaction)
  }
})

test('standalone credit payments update partial and full balances consistently', async () => {
  const cases = [
    {
      amount: '60.00', paid: '85.50', remaining: '100.00', status: 'Partially Paid', customerBalance: '100.00',
    },
    {
      amount: '160.00', paid: '185.50', remaining: '0.00', status: 'Paid', customerBalance: '0.00',
    },
  ]

  for (const expected of cases) {
    const fixture = paymentConnection({
      sale: {
        customer_id: 9,
        payment_type: 'Credit',
        total_amount: '185.50',
        amount_paid: '25.50',
        remaining_balance: '160.00',
        status: 'Partially Paid',
      },
      customerBalance: '160.00',
    })
    const result = response()
    await withConnection(fixture.connection, () => recordPayment(request({
      sale_id: 100,
      payment_amount: expected.amount,
    }), result))

    assert.equal(result.statusCode, 201)
    assert.equal(result.body.data.payment_amount, expected.amount)
    assert.equal(result.body.data.remaining_balance, expected.remaining)
    assert.equal(result.body.data.status, expected.status)
    assert.equal(fixture.state.sale.amount_paid, expected.paid)
    assert.equal(fixture.state.sale.remaining_balance, expected.remaining)
    assert.equal(fixture.state.sale.status, expected.status)
    assert.equal(fixture.state.customerBalance, expected.customerBalance)
    assert.equal(fixture.state.payments.length, 1)
    assert.equal(fixture.state.committed, true)
  }
})

test('standalone payment rejects negative, invalid, and over-balance amounts without writes', async () => {
  for (const amount of ['-0.01', 'NaN', 'Infinity', '1.001', '160.01']) {
    const fixture = paymentConnection({
      sale: {
        customer_id: 9,
        payment_type: 'Credit',
        total_amount: '185.50',
        amount_paid: '25.50',
        remaining_balance: '160.00',
        status: 'Partially Paid',
      },
      customerBalance: '160.00',
    })
    const result = response()
    await withConnection(fixture.connection, () => recordPayment(request({ sale_id: 100, payment_amount: amount }), result))

    assert.equal(result.statusCode, 400, `payment amount ${amount}`)
    assert.equal(fixture.state.sale.amount_paid, '25.50')
    assert.equal(fixture.state.sale.remaining_balance, '160.00')
    assert.equal(fixture.state.customerBalance, '160.00')
    assert.deepEqual(fixture.state.payments, [])
    assert.equal(fixture.state.committed, false)
    assert.equal(fixture.state.rolledBack, amount === '160.01')
  }
})

test('failed payment insert rolls back sale and customer balance updates', async () => {
  const fixture = paymentConnection({
    sale: {
      customer_id: 9,
      payment_type: 'Credit',
      total_amount: '185.50',
      amount_paid: '25.50',
      remaining_balance: '160.00',
      status: 'Partially Paid',
    },
    customerBalance: '160.00',
    failPaymentInsert: true,
  })
  const result = response()
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    await withConnection(fixture.connection, () => recordPayment(request({ sale_id: 100, payment_amount: '60.00' }), result))
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(result.statusCode, 500)
  assert.equal(fixture.state.sale.amount_paid, '25.50')
  assert.equal(fixture.state.sale.remaining_balance, '160.00')
  assert.equal(fixture.state.customerBalance, '160.00')
  assert.deepEqual(fixture.state.payments, [])
  assert.equal(fixture.state.committed, false)
  assert.equal(fixture.state.rolledBack, true)
})
