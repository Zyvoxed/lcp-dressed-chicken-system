import { useEffect, useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { getSalesReportDetail } from '../../services/reportService.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import { toTransactionCents } from '../../utils/transactionMoney.js'
import { buildSalesReportPaymentRecords } from './salesReportPaymentRecords.js'

function DetailRow({ label, value, emphasis = false }) {
  return <div className={emphasis ? 'report-detail-emphasis' : ''}><dt>{label}</dt><dd>{value}</dd></div>
}

function formatPaymentAmount(value) {
  try {
    toTransactionCents(value)
    return peso.format(Number(value))
  } catch {
    return 'Amount unavailable'
  }
}

function TransactionDetailsModal({ saleId, onClose }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    getSalesReportDetail(saleId, { signal: controller.signal })
      .then(setDetails)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [saleId])

  const sale = details?.sale
  const paymentRecords = buildSalesReportPaymentRecords(sale, details?.payments)

  return (
    <Modal title={`Transaction OR-${saleId}`} onClose={onClose} className="report-transaction-modal">
      {loading && <LoadingSpinner />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && sale && <div className="report-detail-content">
        <section className="report-detail-section" aria-labelledby="transaction-information-heading">
          <h3 id="transaction-information-heading">Transaction Information</h3>
          <dl className="transaction-detail-list">
            <DetailRow label="Transaction ID" value={`OR-${sale.sale_id}`} />
            <DetailRow label="Date and time" value={formatActivityTimestamp(sale.sale_date).dateTime} />
            <DetailRow label="Recorded by" value={sale.recorded_by} />
          </dl>
        </section>

        <section className="report-detail-section" aria-labelledby="customer-information-heading">
          <h3 id="customer-information-heading">Customer Information</h3>
          <dl className="transaction-detail-list">
            <DetailRow label="Customer type" value={sale.customer_type} />
            <DetailRow label="Name" value={sale.customer_name} />
            {sale.contact_number && <DetailRow label="Contact number" value={sale.contact_number} />}
            {sale.address && <DetailRow label="Address" value={sale.address} />}
          </dl>
        </section>

        <section className="report-detail-section" aria-labelledby="purchased-products-heading">
          <h3 id="purchased-products-heading">Purchased Products</h3>
          <div className="report-detail-table-wrap">
            <table className="system-data-table report-detail-table">
              <thead><tr><th>Product</th><th>Quantity</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
              <tbody>{details.items.map((item) => <tr key={item.salesitem_id}>
                <td>{item.product_name}</td>
                <td>{Number(item.quantity).toLocaleString('en-PH', { maximumFractionDigits: 3 })} {item.unit}</td>
                <td>{peso.format(Number(item.price))}</td>
                <td>{peso.format(Number(item.subtotal))}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="report-detail-section" aria-labelledby="payment-summary-heading">
          <h3 id="payment-summary-heading">Payment Summary</h3>
          <dl className="transaction-detail-list">
            <DetailRow label="Payment method" value={sale.payment_type} />
            <DetailRow label="Payment status" value={<StatusBadge value={sale.status} />} />
            <DetailRow label="Amount paid" value={peso.format(Number(sale.amount_paid))} />
            <DetailRow label="Remaining balance" value={peso.format(Number(sale.remaining_balance))} />
            <DetailRow label="Transaction total" value={peso.format(Number(sale.total_amount))} emphasis />
          </dl>
        </section>

        <section className="report-detail-section" aria-labelledby="payment-records-heading">
          <h3 id="payment-records-heading">Payment Records</h3>
          {paymentRecords.length ? <div className="report-payment-records">
            {paymentRecords.map((payment, index) => {
              const record = payment && typeof payment === 'object' ? payment : {}
              return (
                <article key={record.history_id || (record.payment_id ? `payment-${record.payment_id}` : `payment-record-${index}`)}>
                  <div>
                    <strong>{formatPaymentAmount(record.payment_amount)}</strong>
                    <span>{record.history_type === 'initial-downpayment'
                      ? 'Initial Down Payment'
                      : record.payment_id ? `Payment #${record.payment_id}` : 'Payment record'}</span>
                  </div>
                  <p><time dateTime={record.payment_date || undefined}>{formatActivityTimestamp(record.payment_date).dateTime}</time></p>
                  <p>Recorded by {record.recorded_by || 'Unknown'} · Balance after payment: {formatPaymentAmount(record.remaining_balance)}</p>
                </article>
              )
            })}
          </div> : (
            <p className="report-detail-note">
              {!Array.isArray(details.payments)
                ? 'Payment records are unavailable for this transaction.'
                : sale.payment_type === 'Cash'
                  ? 'No separate payment records are expected for this cash transaction.'
                  : 'No subsequent payment records are available for this transaction.'}
            </p>
          )}
        </section>
      </div>}
    </Modal>
  )
}

export default TransactionDetailsModal
