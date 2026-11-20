import { toTransactionCents, transactionCentsToAmount } from '../../utils/transactionMoney.js'

function amountInCents(value) {
  try {
    return toTransactionCents(value)
  } catch {
    return null
  }
}

export function buildCustomerPaymentHistory(credits, payments) {
  const paymentsBySale = new Map()
  const invalidPaymentSales = new Set()
  for (const payment of payments) {
    const saleId = String(payment.sale_id)
    const current = paymentsBySale.get(saleId) || 0n
    const paymentCents = amountInCents(payment.payment_amount)
    if (paymentCents === null) {
      invalidPaymentSales.add(saleId)
      continue
    }
    paymentsBySale.set(saleId, current + paymentCents)
  }

  const initialDownpayments = []
  for (const sale of credits) {
    if (invalidPaymentSales.has(String(sale.sale_id))) continue
    const paidCents = amountInCents(sale.amount_paid)
    const totalCents = amountInCents(sale.total_amount)
    if (paidCents === null || totalCents === null) continue

    const subsequentCents = paymentsBySale.get(String(sale.sale_id)) || 0n
    const initialCents = paidCents - subsequentCents
    if (initialCents <= 0n || initialCents > totalCents) continue

    initialDownpayments.push({
      history_id: `initial-downpayment-${sale.sale_id}`,
      history_type: 'initial-downpayment',
      sale_id: sale.sale_id,
      payment_amount: transactionCentsToAmount(initialCents),
      payment_date: sale.sale_date,
      recorded_by: sale.recorded_by,
    })
  }

  return [...payments, ...initialDownpayments].sort((left, right) => {
    const dateDifference = new Date(right.payment_date).getTime() - new Date(left.payment_date).getTime()
    if (Number.isFinite(dateDifference) && dateDifference !== 0) return dateDifference
    return Number(right.payment_id || 0) - Number(left.payment_id || 0)
  })
}
