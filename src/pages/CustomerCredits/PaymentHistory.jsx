import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import StatusBadge from '../Shared/StatusBadge.jsx'

function PaymentHistory({ credits, payments }) {
  return (
    <div className="history-grid">
      <section aria-labelledby="credit-history-heading">
        <h3 id="credit-history-heading">Sales History</h3>
        <div className="history-list">
          {credits.map((credit) => (
            <article className="history-record credit" key={credit.sale_id}>
              <header><strong>OR-{credit.sale_id}</strong><StatusBadge value={credit.status} /></header>
              {credit.sale_date && <time dateTime={credit.sale_date}>{formatActivityTimestamp(credit.sale_date).dateTime}</time>}
              <dl>
                <div><dt>Sale total</dt><dd>{peso.format(Number(credit.total_amount))}</dd></div>
                <div><dt>Amount paid</dt><dd>{peso.format(Number(credit.amount_paid))}</dd></div>
                <div><dt>Remaining</dt><dd>{peso.format(Number(credit.remaining_balance))}</dd></div>
              </dl>
              {credit.recorded_by && <footer>Recorded by {credit.recorded_by}</footer>}
            </article>
          ))}
          {!credits.length && <p className="history-empty">No credit sales recorded.</p>}
        </div>
      </section>
      <section aria-labelledby="payment-history-heading">
        <h3 id="payment-history-heading">Payment History</h3>
        <div className="history-list">
          {payments.map((payment) => (
            <article className="history-record payment" key={payment.payment_id}>
              <header><strong>PAY-{payment.payment_id}</strong><span>{peso.format(Number(payment.payment_amount))}</span></header>
              <time dateTime={payment.payment_date}>{formatActivityTimestamp(payment.payment_date).dateTime}</time>
              <dl>
                <div><dt>Applied to</dt><dd>OR-{payment.sale_id}</dd></div>
                <div><dt>Remaining after payment</dt><dd>{peso.format(Number(payment.remaining_balance))}</dd></div>
              </dl>
              {payment.recorded_by && <footer>Recorded by {payment.recorded_by}</footer>}
            </article>
          ))}
          {!payments.length && <p className="history-empty">No payments recorded.</p>}
        </div>
      </section>
    </div>
  )
}

export default PaymentHistory
