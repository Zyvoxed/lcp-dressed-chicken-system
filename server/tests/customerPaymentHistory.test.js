import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCustomerPaymentHistory } from '../../src/pages/CustomerCredits/paymentHistory.js'

const sale = (overrides = {}) => ({
  sale_id: 12,
  sale_date: '2026-11-01T09:00:00+08:00',
  total_amount: '5000.00',
  amount_paid: '1000.00',
  recorded_by: 'Test Admin',
  ...overrides,
})

test('shows only the initial downpayment when no later payment exists', () => {
  const history = buildCustomerPaymentHistory([sale()], [])

  assert.equal(history.length, 1)
  assert.equal(history[0].history_type, 'initial-downpayment')
  assert.equal(history[0].payment_amount, '1000.00')
})

test('shows the initial downpayment and subsequent payments exactly once', () => {
  const history = buildCustomerPaymentHistory(
    [sale({ amount_paid: '1500.00' })],
    [{ payment_id: 5, sale_id: 12, payment_amount: '500.00', payment_date: '2026-11-02T09:00:00+08:00' }],
  )

  assert.equal(history.length, 2)
  assert.equal(history.filter((entry) => entry.history_type === 'initial-downpayment').length, 1)
  assert.equal(history.find((entry) => entry.history_type === 'initial-downpayment').payment_amount, '1000.00')
  assert.equal(history.find((entry) => entry.payment_id === 5).payment_amount, '500.00')
})

test('does not fabricate an initial payment for a zero-downpayment credit sale', () => {
  const history = buildCustomerPaymentHistory([sale({ amount_paid: '0.00' })], [])

  assert.deepEqual(history, [])
})

test('shows a fully paid credit sale initial payment once', () => {
  const history = buildCustomerPaymentHistory(
    [sale({ amount_paid: '5000.00' })],
    [],
  )

  assert.equal(history.length, 1)
  assert.equal(history[0].payment_amount, '5000.00')
})

test('does not infer a downpayment when stored totals cannot reconcile', () => {
  const history = buildCustomerPaymentHistory(
    [sale({ amount_paid: '400.00' })],
    [{ payment_id: 5, sale_id: 12, payment_amount: '500.00' }],
  )

  assert.deepEqual(history, [{ payment_id: 5, sale_id: 12, payment_amount: '500.00' }])
})

test('shows one fully paid cash sale using its sale date and amount paid', () => {
  const cashSale = {
    sale_id: 23,
    sale_date: '2026-11-03T12:00:00+08:00',
    amount_paid: '1250.00',
    payment_type: 'Cash',
    status: 'Paid',
  }
  const history = buildCustomerPaymentHistory([], [], [cashSale, cashSale])

  assert.equal(history.length, 1)
  assert.equal(history[0].history_type, 'cash-sale')
  assert.equal(history[0].history_id, 'cash-sale-23')
  assert.equal(history[0].payment_amount, '1250.00')
  assert.equal(history[0].payment_date, cashSale.sale_date)
})

test('excludes cash sales with unpaid, malformed, or incomplete settlement data', () => {
  const valid = {
    sale_id: 23,
    sale_date: '2026-11-03T12:00:00+08:00',
    amount_paid: '1250.00',
    payment_type: 'Cash',
    status: 'Paid',
  }
  const history = buildCustomerPaymentHistory([], [], [
    valid,
    { ...valid, sale_id: 24, remaining_balance: '1.00' },
    { ...valid, sale_id: 25, total_amount: '1251.00' },
    { ...valid, sale_id: 26, status: 'Unpaid' },
    { ...valid, sale_id: 27, payment_type: 'Credit' },
    { ...valid, sale_id: 28, sale_date: 'invalid' },
    { ...valid, sale_id: 29, amount_paid: 'bad' },
  ])

  assert.deepEqual(history.map((entry) => entry.sale_id), [23])
})

test('sorts cash sales, initial credit payments, and later payments newest first', () => {
  const history = buildCustomerPaymentHistory(
    [sale({ sale_date: '2026-11-01T09:00:00+08:00', amount_paid: '1500.00' })],
    [{ payment_id: 5, sale_id: 12, payment_amount: '500.00', payment_date: '2026-11-04T09:00:00+08:00' }],
    [{ sale_id: 23, sale_date: '2026-11-03T12:00:00+08:00', amount_paid: '1250.00', payment_type: 'Cash', status: 'Paid' }],
  )

  assert.deepEqual(history.map((entry) => entry.history_type || (entry.payment_id ? 'payment' : null)), [
    'payment', 'cash-sale', 'initial-downpayment',
  ])
})

test('returns an empty list when there are no cash sales or credit payment events', () => {
  assert.deepEqual(buildCustomerPaymentHistory([], [], []), [])
})
