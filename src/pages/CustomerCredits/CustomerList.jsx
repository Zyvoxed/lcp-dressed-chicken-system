import StatusBadge from '../Shared/StatusBadge.jsx'
import { debtors } from '../../data/customers.js'
import { peso } from '../../utils/currency.js'

function CustomerList() {
  return (
    <article className="panel">
      <h2>AGING CUSTOMER RECEIVABLES</h2>
      <div className="debtor-list">
        {debtors.map(([name, phone, address, balance, status]) => (
          <div className="debtor-row" key={name}>
            <div>
              <strong>{name}</strong>
              <p>{phone}</p>
              <span>{address}</span>
            </div>
            <div>
              <b>{peso.format(balance)}</b>
              <StatusBadge value={status} as="em" />
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

export default CustomerList
