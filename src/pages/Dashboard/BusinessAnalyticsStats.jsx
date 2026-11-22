import { Award, PhilippinePeso, ReceiptText, Sigma } from 'lucide-react'
import { peso } from '../../utils/currency.js'

function BusinessAnalyticsStats({ summary }) {
  const topSellers = summary.top_sellers_by_unit || []
  return (
    <div className="business-kpi-grid">
      <article>
        <header><span>COMPLETED SALES</span><ReceiptText size={18} aria-hidden="true" /></header>
        <strong>{Number(summary.total_transactions).toLocaleString('en-PH')}</strong>
        <p>Recorded transactions</p>
      </article>
      <article>
        <header><span>GROSS SALES</span><PhilippinePeso size={18} aria-hidden="true" /></header>
        <strong>{peso.format(Number(summary.gross_revenue))}</strong>
        <p>Cash and credit sales</p>
      </article>
      <article>
        <header><span>AVERAGE SALE AMOUNT</span><Sigma size={18} aria-hidden="true" /></header>
        <strong>{peso.format(Number(summary.average_ticket_value))}</strong>
        <p>Average amount per sale</p>
      </article>
      <article>
        <header><span className="accent">TOP PRODUCT BY UNIT</span><Award size={18} aria-hidden="true" /></header>
        <strong className="seller-name">{topSellers.length ? topSellers.map((product) => `${product.product_name} (${product.unit})`).join(' · ') : 'No sales data yet'}</strong>
        <p>{topSellers.length ? 'Highest quantity within each unit' : 'No completed product sales'}</p>
      </article>
    </div>
  )
}

export default BusinessAnalyticsStats
