import { peso } from '../../utils/currency.js'

function PaymentHistory({ credits, payments }) {
  return (
    <div className="history-grid">
      <div>
        <h3>Credit Sales History</h3>
        {credits.map((credit) => <p key={credit.sale_id}>OR-{credit.sale_id} - {peso.format(Number(credit.total_amount))} ({credit.status})</p>)}
        {!credits.length && <p>No credit sales recorded.</p>}
      </div>
      <div>
        <h3>Payment History</h3>
        {payments.map((payment) => <p key={payment.payment_id}>{new Date(payment.payment_date).toLocaleDateString()} - {peso.format(Number(payment.payment_amount))}</p>)}
        {!payments.length && <p>No payments recorded.</p>}
      </div>
    </div>
  )
}

export default PaymentHistory
