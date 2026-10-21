import PaymentHistory from './PaymentHistory.jsx'
import PaymentForm from './PaymentForm.jsx'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'

function CustomerLedger({ customer, credits, payments, onPayment, loading, error }) {
  if (!customer) return <article className="panel ledger-panel"><h2>Customer Details</h2><EmptyState>No customers found.</EmptyState></article>
  const hasCreditHistory = credits.length > 0

  return (
    <article className="panel ledger-panel">
      <div className="ledger-heading">
        <div>
          <span>CUSTOMER DETAILS</span>
          <h2>{customer.customer_name}</h2>
        </div>
        <span className={`customer-type-badge ${hasCreditHistory ? 'credit' : ''}`}>
          {hasCreditHistory ? 'Credit Customer' : 'Registered Customer'}
        </span>
      </div>
      <section className="customer-information" aria-labelledby="customer-information-heading">
        <h3 id="customer-information-heading">Customer Information</h3>
        <dl className="customer-information-grid">
          <div><dt>Customer type</dt><dd>{hasCreditHistory ? 'Has recorded credit sales' : 'No recorded credit sales'}</dd></div>
          <div><dt>Contact number</dt><dd>{customer.contact_number || 'Not provided'}</dd></div>
          <div className="wide"><dt>Address</dt><dd>{customer.address || 'Not provided'}</dd></div>
          {customer.created_at && <div className="wide"><dt>Registered</dt><dd>{formatActivityTimestamp(customer.created_at).dateTime}</dd></div>}
        </dl>
      </section>
      <div className="balance-display">
        <span>Total Outstanding Balance</span>
        <strong>{peso.format(Number(customer.current_balance))}</strong>
        <small>Calculated by the existing customer credit ledger.</small>
      </div>
      {loading && <LoadingSpinner />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && <PaymentForm key={customer.customer_id} customer={customer} credits={credits} onRecorded={onPayment} />}
      {!loading && !error && <PaymentHistory credits={credits} payments={payments} />}
    </article>
  )
}

export default CustomerLedger
