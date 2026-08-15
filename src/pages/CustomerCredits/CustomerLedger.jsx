import PaymentHistory from './PaymentHistory.jsx'
import PaymentForm from './PaymentForm.jsx'
import { peso } from '../../utils/currency.js'

function CustomerLedger({ customer, credits, payments, onPayment }) {
  if (!customer) return <article className="panel ledger-panel"><h2>Customer Ledger</h2><p>No customers found.</p></article>
  return (
    <article className="panel ledger-panel">
      <h2>Customer Ledger</h2>
      <div className="balance-display">
        <span>Outstanding balance</span>
        <strong>{peso.format(Number(customer.current_balance))}</strong>
      </div>
      <PaymentForm credits={credits} onRecorded={onPayment} />
      <PaymentHistory credits={credits} payments={payments} />
    </article>
  )
}

export default CustomerLedger
