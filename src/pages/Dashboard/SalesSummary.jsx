import { Lightbulb } from 'lucide-react'
import { peso, wholeNumber } from '../../utils/currency.js'

function SalesSummary({ summary }) {
  const rows = [
    ['Total Sales', peso.format(Number(summary.total_revenue)), 'money'],
    ['Total Transactions', `${wholeNumber.format(Number(summary.total_transactions))} Invoices`, 'numeric'],
    ['Average Sale Value', peso.format(Number(summary.average_sale_value)), 'positive money'],
    ['Best Seller', summary.best_seller || 'No sales recorded', 'accent'],
  ]

  return (
    <article className="panel dashboard-summary-panel">
      <header><h2>SALES SUMMARY</h2><p>Key sales details</p></header>
      <div className="dashboard-summary-list">
        {rows.map(([label, value, tone]) => (
          <div key={label}>
            <span>{label}</span>
            <strong className={tone} title={value}>{value}</strong>
          </div>
        ))}
      </div>
      <div className="dashboard-info-box"><Lightbulb size={18} aria-hidden="true" /><p>Based on recorded sales.</p></div>
    </article>
  )
}

export default SalesSummary
