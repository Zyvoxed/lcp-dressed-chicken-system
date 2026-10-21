import { useEffect, useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { getSalesReportDetail } from '../../services/reportService.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

function DetailRow({ label, value, emphasis = false }) {
  return <div className={emphasis ? 'report-detail-emphasis' : ''}><dt>{label}</dt><dd>{value}</dd></div>
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
          {details.payments.length ? <div className="report-payment-records">
            {details.payments.map((payment) => <article key={payment.payment_id}>
              <div><strong>{peso.format(Number(payment.payment_amount))}</strong><span>Payment #{payment.payment_id}</span></div>
              <p><time dateTime={payment.payment_date}>{formatActivityTimestamp(payment.payment_date).dateTime}</time></p>
              <p>Recorded by {payment.recorded_by} · Balance after payment: {peso.format(Number(payment.remaining_balance))}</p>
            </article>)}
          </div> : <p className="report-detail-note">{sale.payment_type === 'Cash'
            ? 'No separate payment records are expected for this cash transaction.'
            : 'No subsequent payment records are available for this transaction.'}</p>}
        </section>
      </div>}
    </Modal>
  )
}

export default TransactionDetailsModal
