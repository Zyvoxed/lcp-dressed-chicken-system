import { Boxes, CircleAlert, HandCoins, WalletCards } from 'lucide-react'
import { peso } from '../../utils/currency.js'

function DashboardStats({ summary }) {
  const stats = [
    { label: 'Total Sales', value: peso.format(Number(summary.total_revenue)), note: 'All recorded cash and credit sales', Icon: HandCoins, tone: 'positive' },
    { label: 'Total Products', value: `${summary.total_products} Items`, note: 'Active products', Icon: Boxes, tone: 'neutral' },
    { label: 'Low Stock Items', value: `${summary.low_stock_count} Alerts`, note: 'At or below the low-stock level', Icon: CircleAlert, tone: 'warning' },
    { label: 'Unpaid Customer Balances', value: peso.format(Number(summary.customer_credits)), note: 'Total unpaid customer balance', Icon: WalletCards, tone: 'danger' },
  ]

  return (
    <div className="dashboard-kpi-grid">
      {stats.map(({ label, value, note, Icon, tone }) => (
        <article className={`dashboard-kpi-card ${tone}`} key={label}>
          <div><p>{label}</p><Icon size={18} aria-hidden="true" /></div>
          <strong title={value}>{value}</strong>
          <span>• {note}</span>
        </article>
      ))}
    </div>
  )
}

export default DashboardStats
