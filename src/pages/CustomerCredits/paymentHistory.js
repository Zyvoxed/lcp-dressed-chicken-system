import { toTransactionCents, transactionCentsToAmount } from '../../utils/transactionMoney.js'

function amountInCents(value) {
  try {
    return toTransactionCents(value)
  } catch {
    return null
  }
}

export function buildCustomerPaymentHistory(credits, payments, cashSales = []) {
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

  const seenCashSaleIds = new Set()
  const paidCashSales = []
  for (const sale of cashSales) {
    const saleId = String(sale?.sale_id ?? '')
    const paidCents = amountInCents(sale?.amount_paid)
    const totalCents = sale?.total_amount === undefined ? paidCents : amountInCents(sale.total_amount)
    const remainingCents = sale?.remaining_balance === undefined ? 0n : amountInCents(sale.remaining_balance)
    const timestamp = Date.parse(sale?.sale_date)
    if (!saleId || seenCashSaleIds.has(saleId)
      || sale?.payment_type !== 'Cash' || sale?.status !== 'Paid'
      || paidCents === null || totalCents === null || remainingCents !== 0n
      || paidCents !== totalCents || !Number.isFinite(timestamp)) continue
    seenCashSaleIds.add(saleId)
    paidCashSales.push({
      history_id: `cash-sale-${saleId}`,
      history_type: 'cash-sale',
      sale_id: sale.sale_id,
      payment_amount: sale.amount_paid,
      payment_date: sale.sale_date,
      payment_type: 'Cash',
      status: 'Paid',
      remaining_balance: '0.00',
    })
  }

  return [...payments, ...initialDownpayments, ...paidCashSales].sort((left, right) => {
    const dateDifference = new Date(right.payment_date).getTime() - new Date(left.payment_date).getTime()
    if (Number.isFinite(dateDifference) && dateDifference !== 0) return dateDifference
    return Number(right.payment_id || 0) - Number(left.payment_id || 0)
  })
}
