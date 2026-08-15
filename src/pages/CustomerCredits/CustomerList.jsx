import StatusBadge from '../Shared/StatusBadge.jsx'
import { peso } from '../../utils/currency.js'

function CustomerList({ customers, selectedCustomer, onSelect }) {
  return (
    <article className="panel">
      <h2>AGING CUSTOMER RECEIVABLES</h2>
      <div className="debtor-list">
        {customers.map((customer) => (
          <div className={`debtor-row ${selectedCustomer?.customer_id === customer.customer_id ? 'selected' : ''}`} key={customer.customer_id} onClick={() => onSelect(customer)}>
            <div>
              <strong>{customer.customer_name}</strong>
              <p>{customer.contact_number || '—'}</p>
              <span>{customer.address || '—'}</span>
            </div>
            <div>
              <b>{peso.format(Number(customer.current_balance))}</b>
              <StatusBadge value={Number(customer.current_balance) > 0 ? 'Unpaid' : 'Paid'} as="em" />
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

export default CustomerList
