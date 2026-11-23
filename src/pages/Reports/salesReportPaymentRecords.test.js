import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesReportPaymentRecords } from './salesReportPaymentRecords.js'
import { toTransactionCents } from '../../utils/transactionMoney.js'

const creditSale = (overrides = {}) => ({
  sale_id: 84,
  payment_type: 'Credit',
  total_amount: '27060.00',
  amount_paid: '7060.00',
  remaining_balance: '20000.00',
  sale_date: '2026-11-20T00:37:22+08:00',
  recorded_by: 'LCP Admin',
  ...overrides,
})

const payment = (overrides = {}) => ({
  payment_id: 23,
  payment_amount: '7000.00',
  remaining_balance: '20000.00',
  payment_date: '2026-11-20T02:09:28+08:00',
  recorded_by: 'LCP Admin',
  ...overrides,
})

test('reconstructs the verified initial down payment without changing cumulative amount paid', () => {
  const sale = creditSale()
  const laterPayment = payment()
  const records = buildSalesReportPaymentRecords(sale, [laterPayment])

  assert.equal(records.length, 2)
  assert.equal(records[0].history_type, 'initial-downpayment')
  assert.equal(records[0].payment_amount, '60.00')
  assert.equal(records[0].remaining_balance, '27000.00')
  assert.equal(records[0].payment_date, sale.sale_date)
  assert.equal(records[0].recorded_by, sale.recorded_by)
  assert.equal(records[1], laterPayment)
  assert.equal(records.reduce((sum, row) => sum + toTransactionCents(row.payment_amount), 0n), toTransactionCents(sale.amount_paid))
  assert.equal(sale.amount_paid, '7060.00')
})

test('shows a credit down payment when there are no subsequent payment records', () => {
  const records = buildSalesReportPaymentRecords(creditSale({ amount_paid: '125.35', total_amount: '500.00' }), [])
  assert.equal(records.length, 1)
  assert.equal(records[0].history_type, 'initial-downpayment')
  assert.equal(records[0].payment_amount, '125.35')
})

test('does not show a down payment for zero-paid credit sales', () => {
  assert.deepEqual(buildSalesReportPaymentRecords(creditSale({ amount_paid: '0.00' }), []), [])
})

test('does not infer a down payment when later payments already equal the fully paid sale amount', () => {
  const sale = creditSale({ total_amount: '100.00', amount_paid: '100.00' })
  const records = buildSalesReportPaymentRecords(sale, [
    payment({ payment_id: 25, payment_amount: '60.00', payment_date: '2026-11-21T09:00:00+08:00' }),
    payment({ payment_id: 24, payment_amount: '40.00', payment_date: '2026-11-21T08:00:00+08:00' }),
  ])
  assert.deepEqual(records.map(({ payment_id }) => payment_id), [24, 25])
  assert.ok(records.every((row) => row.history_type !== 'initial-downpayment'))
})

test('shows a credit sale paid in full at creation as one initial payment', () => {
  const records = buildSalesReportPaymentRecords(creditSale({ total_amount: '100.00', amount_paid: '100.00' }), [])
  assert.equal(records.length, 1)
  assert.equal(records[0].history_type, 'initial-downpayment')
  assert.equal(records[0].payment_amount, '100.00')
})

test('does not infer a down payment for cash sales', () => {
  const sale = creditSale({ payment_type: 'Cash', total_amount: '100.00', amount_paid: '100.00' })
  assert.deepEqual(buildSalesReportPaymentRecords(sale, []), [])
})

test('keeps an already represented initial payment without adding a duplicate', () => {
  const initial = { history_type: 'initial-downpayment', payment_amount: '60.00', payment_date: creditSale().sale_date }
  assert.deepEqual(buildSalesReportPaymentRecords(creditSale(), [initial]), [initial])
})

test('orders initial and later payments by their recorded dates', () => {
  const sale = creditSale({ amount_paid: '90.00', total_amount: '100.00' })
  const laterPayments = [
    payment({ payment_id: 26, payment_amount: '20.00', payment_date: '2026-11-22T10:00:00+08:00' }),
    payment({ payment_id: 25, payment_amount: '30.00', payment_date: '2026-11-21T10:00:00+08:00' }),
  ]
  const records = buildSalesReportPaymentRecords(sale, laterPayments)
  assert.deepEqual(records.map(({ history_type, payment_id }) => history_type || payment_id), [
    'initial-downpayment', 25, 26,
  ])
})

test('does not invent a down payment from missing, malformed, or inconsistent legacy payment data', () => {
  const sale = creditSale()
  assert.deepEqual(buildSalesReportPaymentRecords(sale, undefined), [])
  assert.deepEqual(buildSalesReportPaymentRecords(creditSale({ amount_paid: 'invalid' }), []), [])
  assert.deepEqual(buildSalesReportPaymentRecords(sale, [payment({ payment_amount: '7000.001' })]), [payment({ payment_amount: '7000.001' })])
  assert.deepEqual(buildSalesReportPaymentRecords(sale, [null]), [null])
  assert.deepEqual(buildSalesReportPaymentRecords(creditSale({ amount_paid: '6999.99' }), [payment()]), [payment()])
  assert.deepEqual(buildSalesReportPaymentRecords(sale, [payment({ payment_date: '2026-11-19T23:00:00+08:00' })]), [payment({ payment_date: '2026-11-19T23:00:00+08:00' })])
  assert.deepEqual(buildSalesReportPaymentRecords(creditSale({ amount_paid: '30000.00' }), []), [])
  assert.deepEqual(buildSalesReportPaymentRecords(creditSale({ sale_date: 'not-a-date' }), []), [])
  assert.deepEqual(buildSalesReportPaymentRecords(creditSale({ sale_date: null }), [payment({ payment_date: 'not-a-date' })]), [payment({ payment_date: 'not-a-date' })])
})
