import PaymentHistory from './PaymentHistory.jsx'
import PaymentForm from './PaymentForm.jsx'
import { peso } from '../../utils/currency.js'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'

function CustomerLedger({ customer, credits, payments, onPayment, loading, error }) {
  if (!customer) return <article className="panel ledger-panel"><h2>Customer Ledger</h2><EmptyState>No customers found.</EmptyState></article>
  return (
    <article className="panel ledger-panel">
      <h2>Customer Ledger</h2>
      <div className="balance-display">
        <span>Outstanding balance</span>
        <strong>{peso.format(Number(customer.current_balance))}</strong>
      </div>
      {loading && <LoadingSpinner />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && <PaymentForm credits={credits} onRecorded={onPayment} />}
      {!loading && !error && <PaymentHistory credits={credits} payments={payments} />}
    </article>
  )
}

export default CustomerLedger
