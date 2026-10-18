import { peso } from '../../utils/currency.js'
import StatusBadge from '../Shared/StatusBadge.jsx'

function PaymentHistory({ credits, payments }) {
  return (
    <div className="history-grid">
      <div>
        <h3>Credit Sales History</h3>
        <div className="history-list">
          {credits.map((credit) => <div className="history-row credit" key={credit.sale_id}><span>OR-{credit.sale_id}</span><strong>{peso.format(Number(credit.total_amount))}</strong><StatusBadge value={credit.status} /></div>)}
          {!credits.length && <p className="history-empty">No credit sales recorded.</p>}
        </div>
      </div>
      <div>
        <h3>Payment History</h3>
        <div className="history-list">
          {payments.map((payment) => <div className="history-row payment" key={payment.payment_id}><time dateTime={payment.payment_date}>{new Date(payment.payment_date).toLocaleDateString()}</time><strong>{peso.format(Number(payment.payment_amount))}</strong></div>)}
          {!payments.length && <p className="history-empty">No payments recorded.</p>}
        </div>
      </div>
    </div>
  )
}

export default PaymentHistory
