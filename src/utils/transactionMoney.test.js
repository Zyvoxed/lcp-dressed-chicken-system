import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatTransactionCents,
  toTransactionCents,
  transactionCentsToAmount,
  transactionLineCents,
  transactionTotalCents,
} from './transactionMoney.js'
import {
  clearPendingTransaction,
  readPendingTransaction,
  savePendingTransaction,
} from './pendingTransaction.js'

test('POS line and transaction totals round every line half-up before summing', () => {
  const lines = [
    { quantity: 0.3, selling_price: '0.05' },
    { quantity: 0.3, selling_price: '0.05' },
  ]
  assert.equal(transactionLineCents(lines[0].quantity, lines[0].selling_price), 2n)
  assert.equal(transactionLineCents(0.5, '0.05'), 3n)
  assert.equal(transactionLineCents(1.5, '0.05'), 8n)
  assert.equal(transactionLineCents('1.125', '185.50'), 20869n)
  assert.equal(transactionLineCents(2, '100.00'), 20000n)
  assert.equal(transactionTotalCents(lines), 4n)
  assert.equal(transactionCentsToAmount(transactionTotalCents(lines)), '0.04')
  assert.equal(formatTransactionCents(transactionTotalCents(lines), {
    format: (amount) => `PHP ${amount.toFixed(2)}`,
  }), 'PHP 0.04')
})

test('POS monetary conversions handle zero and maximum supported input without float arithmetic', () => {
  assert.equal(transactionLineCents(0, '0.00'), 0n)
  assert.equal(toTransactionCents('0.00'), 0n)
  assert.equal(
    transactionCentsToAmount(transactionLineCents('9999999.999', '99999999.99')),
    '999999999800000.00',
  )
  const formatter = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
  assert.equal(
    formatTransactionCents(999999999999999999999n, formatter),
    '₱9,999,999,999,999,999,999.99',
  )
})

test('POS monetary conversions reject invalid, negative, and excess precision values', () => {
  for (const [quantity, price] of [
    [-1, '1.00'],
    ['0.0001', '1.00'],
    ['invalid', '1.00'],
    [1, '-0.01'],
    [1, '0.001'],
  ]) {
    assert.throws(() => transactionLineCents(quantity, price), RangeError)
  }
  assert.throws(() => toTransactionCents('1.005'), RangeError)
})

test('pending transaction recovery is scoped by authenticated user and operation', () => {
  const originalStorage = globalThis.sessionStorage
  const values = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const sale = {
      key: 'sale-key-1',
      state: 'pending',
      payload: { payment_type: 'Cash', amount_paid: '0.02', items: [{ product_id: 1, quantity: 0.3 }] },
      display: { customer_id: null, cart: [{ product_id: 1, product_name: 'Chicken', selling_price: '0.05', quantity: 0.3 }] },
    }
    const stockIn = {
      key: 'stock-key-1',
      state: 'pending',
      payload: { supplier_id: 1, product_id: 1, quantity_received: '2', cost_price: '3.50', delivery_date: '2026-11-07T10:00' },
      display: {
        product: { product_name: 'Chicken', unit: 'kg' },
        supplier: { supplier_name: 'Supplier' },
      },
    }
    const payment = {
      key: 'payment-key-1',
      state: 'pending',
      payload: { sale_id: 1, payment_amount: '2.00' },
      display: { customer_id: 20, customer_name: 'Customer A', credit: { sale_id: 1 } },
    }

    savePendingTransaction('sale', 10, sale)
    assert.deepEqual(readPendingTransaction('sale', 10), sale)
    assert.equal(readPendingTransaction('sale', 20), null)
    assert.equal(readPendingTransaction('payment', 10), null)

    const completedSale = {
      ...sale,
      state: 'completed',
      response: { sale_id: 5, total_amount: '0.02', amount_paid: '0.02', remaining_balance: '0.00' },
    }
    savePendingTransaction('sale', 10, completedSale)
    assert.deepEqual(readPendingTransaction('sale', 10), completedSale)
    assert.equal(readPendingTransaction('sale', 20), null)

    savePendingTransaction('stock_in', 10, stockIn)
    savePendingTransaction('payment', 10, payment)
    assert.deepEqual(readPendingTransaction('stock_in', 10), stockIn)
    assert.deepEqual(readPendingTransaction('payment', 10), payment)
    assert.equal(readPendingTransaction('stock_in', 20), null)
    assert.equal(readPendingTransaction('payment', 20), null)

    clearPendingTransaction('sale', 20)
    assert.deepEqual(readPendingTransaction('sale', 10), completedSale)
    clearPendingTransaction('sale', 10)
    assert.equal(readPendingTransaction('sale', 10), null)
    assert.throws(() => savePendingTransaction('stock_in', 10, {
      key: 'stock-key-1',
      state: 'pending',
      payload: { product_id: 1 },
      display: {},
    }), /recovery data is incomplete/)
    assert.throws(() => readPendingTransaction('sale'), /authenticated user is required/)
  } finally {
    if (originalStorage === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = originalStorage
  }
})

test('logout and in-flight account switching preserve recovery only for the original user', async () => {
  const originalStorage = globalThis.sessionStorage
  const values = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const userA = 41
    const userB = 82
    const originalAttempt = {
      key: 'stable-idempotency-key',
      state: 'pending',
      payload: {
        payment_type: 'Credit',
        customer_id: 9,
        amount_paid: '5.00',
        items: [{ product_id: 3, quantity: '2' }],
      },
      display: {
        customer_id: 9,
        customer_name: 'Customer',
        cart: [{ product_id: 3, product_name: 'Chicken', selling_price: '5.00', quantity: 2 }],
      },
    }

    savePendingTransaction('sale', userA, originalAttempt)
    const inFlightUserId = userA
    assert.equal(readPendingTransaction('sale', userB), null)

    const completedAttempt = {
      ...originalAttempt,
      state: 'completed',
      response: { sale_id: 101, total_amount: '10.00', amount_paid: '5.00', remaining_balance: '5.00' },
    }
    await Promise.resolve()
    savePendingTransaction('sale', inFlightUserId, completedAttempt)

    assert.equal(readPendingTransaction('sale', userB), null)
    assert.deepEqual(readPendingTransaction('sale', userA), completedAttempt)
    assert.equal(readPendingTransaction('sale', userA).key, originalAttempt.key)
    assert.deepEqual(readPendingTransaction('sale', userA).payload, originalAttempt.payload)
    assert.equal([...values.values()].some((value) => /authToken|password/i.test(value)), false)
  } finally {
    if (originalStorage === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = originalStorage
  }
})

test('stored recovery rejects invalid precision, range, signs, and inconsistent transaction fields', () => {
  const originalStorage = globalThis.sessionStorage
  const values = new Map()
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    const sale = {
      key: 'valid-sale',
      state: 'pending',
      payload: {
        customer_id: 1,
        payment_type: 'Credit',
        amount_paid: '1.00',
        items: [{ product_id: 1, quantity: '1.000' }],
      },
      display: {
        customer_id: 1,
        cart: [{ product_id: 1, product_name: 'Chicken', selling_price: '2.00', quantity: '1.000' }],
      },
    }
    const stockIn = {
      key: 'valid-stock-in',
      state: 'pending',
      payload: {
        supplier_id: 2,
        product_id: 1,
        quantity_received: '1.000',
        cost_price: '1.25',
        delivery_date: '2026-11-07T10:00',
      },
      display: {
        product: { product_name: 'Chicken', unit: 'kg' },
        supplier: { supplier_name: 'Supplier' },
      },
    }
    const payment = {
      key: 'valid-payment',
      state: 'pending',
      payload: { sale_id: 5, payment_amount: '1.25' },
      display: { customer_id: 20, customer_name: 'Customer A', credit: { sale_id: 5 } },
    }

    savePendingTransaction('sale', 10, sale)
    savePendingTransaction('stock_in', 10, stockIn)
    savePendingTransaction('payment', 10, payment)
    assert.deepEqual(readPendingTransaction('sale', 10), sale)
    assert.deepEqual(readPendingTransaction('stock_in', 10), stockIn)
    assert.deepEqual(readPendingTransaction('payment', 10), payment)

    const invalidAttempts = [
      ['sale', { ...sale, payload: { ...sale.payload, amount_paid: '-0.01' } }],
      ['sale', {
        ...sale,
        payload: { ...sale.payload, items: [{ product_id: 1, quantity: '1.0001' }] },
        display: { ...sale.display, cart: [{ ...sale.display.cart[0], quantity: '1.0001' }] },
      }],
      ['sale', {
        ...sale,
        display: { ...sale.display, cart: [{ ...sale.display.cart[0], selling_price: '100000000.00' }] },
      }],
      ['stock_in', { ...stockIn, payload: { ...stockIn.payload, cost_price: '-0.01' } }],
      ['stock_in', { ...stockIn, payload: { ...stockIn.payload, cost_price: '100000000.00' } }],
      ['stock_in', { ...stockIn, payload: { ...stockIn.payload, quantity_received: '1.0001' } }],
      ['stock_in', { ...stockIn, payload: { ...stockIn.payload, quantity_received: '10000000.000' } }],
      ['payment', { ...payment, payload: { ...payment.payload, payment_amount: '0.00' } }],
      ['payment', { ...payment, payload: { ...payment.payload, payment_amount: '1.001' } }],
      ['payment', { ...payment, payload: { ...payment.payload, payment_amount: '10000000000.00' } }],
      ['payment', { ...payment, payload: { ...payment.payload, sale_id: 6 } }],
    ]

    for (const [operation, attempt] of invalidAttempts) {
      assert.throws(
        () => savePendingTransaction(operation, 10, attempt),
        /recovery data is incomplete/,
      )
    }
    assert.throws(
      () => savePendingTransaction('payment', 10, { ...payment, display: { credit: { sale_id: 5 } } }),
      /verified customer identity/,
    )

    const oversizedUserId = {
      ...sale,
      display: { ...sale.display, cart: [{ ...sale.display.cart[0], quantity: '10000000.000' }] },
      payload: { ...sale.payload, items: [{ product_id: 1, quantity: '10000000.000' }] },
    }
    assert.throws(() => savePendingTransaction('sale', 10, oversizedUserId), /recovery data is incomplete/)
    assert.throws(() => readPendingTransaction('sale', 0), /authenticated user is required/)

    const rejectedPayment = {
      ...payment,
      state: 'rejected',
      rejection: {
        status: 400,
        code: 'TRANSACTION_REJECTED',
        outcome: 'not_committed',
        message: 'Payment exceeds the outstanding balance',
      },
    }
    savePendingTransaction('payment', 10, rejectedPayment)
    assert.deepEqual(readPendingTransaction('payment', 10), rejectedPayment)

    const completedPayment = {
      ...payment,
      state: 'completed',
      response: {
        payment_id: 900,
        sale_id: 5,
        payment_amount: '1.25',
        remaining_balance: '3.75',
      },
    }
    savePendingTransaction('payment', 10, completedPayment)
    assert.deepEqual(readPendingTransaction('payment', 10), completedPayment)
    for (const response of [
      { ...completedPayment.response, sale_id: 6 },
      { ...completedPayment.response, payment_amount: '1.24' },
      { ...completedPayment.response, customer_id: 21 },
      { ...completedPayment.response, remaining_balance: '-0.01' },
    ]) {
      assert.throws(
        () => savePendingTransaction('payment', 10, { ...completedPayment, response }),
        /recovery data is incomplete/,
      )
    }
  } finally {
    if (originalStorage === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = originalStorage
  }
})

test('unscoped legacy attempts are quarantined without exposing or deleting them', () => {
  const originalStorage = globalThis.sessionStorage
  const values = new Map([
    ['lcp.pending-transaction.v1.sale', JSON.stringify({
      key: 'legacy-key',
      state: 'pending',
      payload: { payment_type: 'Cash' },
      display: { customer_name: 'Legacy customer' },
    })],
  ])
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  try {
    assert.throws(
      () => readPendingTransaction('sale', 82),
      /cannot safely be assigned to this user/,
    )
    assert.equal(values.has('lcp.pending-transaction.v1.sale'), true)
    assert.equal(values.get('lcp.pending-transaction.v1.sale').includes('Legacy customer'), true)
  } finally {
    if (originalStorage === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = originalStorage
  }
})
