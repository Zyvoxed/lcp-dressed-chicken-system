import PaymentHistory from './PaymentHistory.jsx'
import PaymentForm from './PaymentForm.jsx'
import { peso } from '../../utils/currency.js'

function CustomerLedger() {
  return (
    <article className="panel ledger-panel">
      <h2>Customer Ledger</h2>
      <div className="balance-display">
        <span>Outstanding balance</span>
        <strong>{peso.format(2450)}</strong>
      </div>
      <PaymentForm />
      <PaymentHistory />
    </article>
  )
}

export default CustomerLedger
