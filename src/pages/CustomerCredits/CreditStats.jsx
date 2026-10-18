import StatCard from '../Shared/StatCard.jsx'
import { peso } from '../../utils/currency.js'

function CreditStats({ customers }) {
  const receivables = customers.reduce((sum, customer) => sum + Number(customer.current_balance), 0)
  const debtors = customers.filter((customer) => Number(customer.current_balance) > 0).length
  return (
    <div className="stats-grid compact full-span credit-stats">
      <StatCard label="Total Unpaid Customer Balance" value={peso.format(receivables)} />
      <StatCard label="Customers With Unpaid Balances" value={debtors} />
      <StatCard label="Registered Customers" value={customers.length} />
    </div>
  )
}

export default CreditStats
