import { Award, PhilippinePeso, ReceiptText, Sigma } from 'lucide-react'
import { peso } from '../../utils/currency.js'

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function BusinessAnalyticsStats({ summary }) {
  const topSeller = summary.top_seller
  return (
    <div className="business-kpi-grid">
      <article>
        <header><span>COMPLETED SALES</span><ReceiptText size={18} aria-hidden="true" /></header>
        <strong>{Number(summary.total_transactions).toLocaleString('en-PH')}</strong>
        <p>Recorded transactions</p>
      </article>
      <article className="outlined">
        <header><span>GROSS SALES</span><PhilippinePeso size={18} aria-hidden="true" /></header>
        <strong>{peso.format(Number(summary.gross_revenue))}</strong>
        <p>Cash and credit sales</p>
      </article>
      <article className="outlined">
        <header><span>AVERAGE SALE AMOUNT</span><Sigma size={18} aria-hidden="true" /></header>
        <strong>{peso.format(Number(summary.average_ticket_value))}</strong>
        <p>Average amount per sale</p>
      </article>
      <article>
        <header><span className="accent">TOP-SELLING PRODUCT</span><Award size={18} aria-hidden="true" /></header>
        <strong className="seller-name">{topSeller?.product_name || 'No sales data yet'}</strong>
        <p>{topSeller ? `${formatQuantity(topSeller.quantity_sold)} ${topSeller.unit} sold` : 'No completed product sales'}</p>
      </article>
    </div>
  )
}

export default BusinessAnalyticsStats
