import { Boxes, CircleAlert, HandCoins, WalletCards } from 'lucide-react'
import { peso } from '../../utils/currency.js'

function DashboardStats({ summary }) {
  const stats = [
    { label: 'Total Revenue', value: peso.format(Number(summary.total_revenue)), note: 'Net operational turnover', Icon: HandCoins, tone: 'positive' },
    { label: 'Total Products', value: `${summary.total_products} Items`, note: 'Vetted catalog entries', Icon: Boxes, tone: 'neutral' },
    { label: 'Low Stock Items', value: `${summary.low_stock_count} Alerts`, note: 'Below safe buffer level', Icon: CircleAlert, tone: 'warning' },
    { label: 'Customer Credits', value: peso.format(Number(summary.customer_credits)), note: 'Active receivables outstanding', Icon: WalletCards, tone: 'danger' },
  ]

  return (
    <div className="dashboard-kpi-grid">
      {stats.map(({ label, value, note, Icon, tone }) => (
        <article className={`dashboard-kpi-card ${tone}`} key={label}>
          <div><p>{label}</p><Icon size={18} aria-hidden="true" /></div>
          <strong>{value}</strong>
          <span>• {note}</span>
        </article>
      ))}
    </div>
  )
}

export default DashboardStats
