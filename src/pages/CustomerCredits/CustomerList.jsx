import StatusBadge from '../Shared/StatusBadge.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import { peso } from '../../utils/currency.js'

function CustomerList({ customers, selectedCustomer, onSelect }) {
  return (
    <article className="panel">
      <h2>CUSTOMER UNPAID BALANCES</h2>
      <div className="debtor-list">
        {!customers.length && <EmptyState>No customers found.</EmptyState>}
        {customers.map((customer) => (
          <button className={`debtor-row ${selectedCustomer?.customer_id === customer.customer_id ? 'selected' : ''}`} type="button" aria-pressed={selectedCustomer?.customer_id === customer.customer_id} key={customer.customer_id} onClick={() => onSelect(customer)}>
            <div>
              <strong>{customer.customer_name}</strong>
              <p>{customer.contact_number || '—'}</p>
              <span>{customer.address || '—'}</span>
            </div>
            <div>
              <b>{peso.format(Number(customer.current_balance))}</b>
              <StatusBadge value={Number(customer.current_balance) > 0 ? 'Unpaid' : 'Paid'} as="em" />
            </div>
          </button>
        ))}
      </div>
    </article>
  )
}

export default CustomerList
