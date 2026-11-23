import { toTransactionCents, transactionCentsToAmount } from '../../utils/transactionMoney.js'

function centsOrNull(value) {
  try {
    return toTransactionCents(value)
  } catch {
    return null
  }
}

function chronologicalPayments(payments) {
  return payments
    .map((payment, index) => ({ payment, index, timestamp: Date.parse(payment?.payment_date) }))
    .sort((left, right) => {
      if (Number.isFinite(left.timestamp) && Number.isFinite(right.timestamp)
        && left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp
      }
      const leftIsInitial = left.payment?.history_type === 'initial-downpayment'
      const rightIsInitial = right.payment?.history_type === 'initial-downpayment'
      if (leftIsInitial !== rightIsInitial) return leftIsInitial ? -1 : 1
      const paymentIdDifference = Number(left.payment?.payment_id || 0) - Number(right.payment?.payment_id || 0)
      return paymentIdDifference || left.index - right.index
    })
    .map(({ payment }) => payment)
}

export function buildSalesReportPaymentRecords(sale, payments) {
  if (!Array.isArray(payments)) return []

  const records = [...payments]
  if (sale?.payment_type !== 'Credit'
    || records.some((payment) => payment?.history_type === 'initial-downpayment')) {
    return chronologicalPayments(records)
  }

  const paidCents = centsOrNull(sale.amount_paid)
  const totalCents = centsOrNull(sale.total_amount)
  const saleTimestamp = Date.parse(sale.sale_date)
  if (paidCents === null || totalCents === null || paidCents > totalCents
    || !Number.isFinite(saleTimestamp) || !sale.recorded_by) {
    return chronologicalPayments(records)
  }

  let laterPaymentsCents = 0n
  for (const payment of records) {
    const paymentCents = centsOrNull(payment?.payment_amount)
    const paymentTimestamp = Date.parse(payment?.payment_date)
    if (paymentCents === null || !Number.isFinite(paymentTimestamp) || paymentTimestamp < saleTimestamp) {
      return chronologicalPayments(records)
    }
    laterPaymentsCents += paymentCents
  }

  const initialCents = paidCents - laterPaymentsCents
  if (initialCents <= 0n || initialCents > totalCents) return chronologicalPayments(records)

  records.push({
    history_id: `initial-downpayment-${sale.sale_id}`,
    history_type: 'initial-downpayment',
    payment_amount: transactionCentsToAmount(initialCents),
    remaining_balance: transactionCentsToAmount(totalCents - initialCents),
    payment_date: sale.sale_date,
    recorded_by: sale.recorded_by,
  })

  return chronologicalPayments(records)
}
