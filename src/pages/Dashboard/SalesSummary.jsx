import { Lightbulb } from 'lucide-react'
import { peso } from '../../utils/currency.js'

function SalesSummary({ summary }) {
  const rows = [
    ['Total Revenue', peso.format(Number(summary.total_revenue)), ''],
    ['Total Transactions', `${summary.total_transactions} Invoices`, ''],
    ['Average Sale Value', peso.format(Number(summary.average_sale_value)), 'positive'],
    ['Best Seller', summary.best_seller || 'No sales recorded', 'accent'],
  ]

  return (
    <article className="panel dashboard-summary-panel">
      <header><h2>SALES SUMMARY</h2><p>Quick operational highlights profile</p></header>
      <div className="dashboard-summary-list">
        {rows.map(([label, value, tone]) => <div key={label}><span>{label}</span><strong className={tone} title={value}>{value}</strong></div>)}
      </div>
      <div className="dashboard-info-box"><Lightbulb size={18} aria-hidden="true" /><p>Sales performance metrics correspond directly to live customer point-of-sale invoices.</p></div>
    </article>
  )
}

export default SalesSummary
