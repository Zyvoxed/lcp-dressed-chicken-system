import { Lightbulb } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function ExecutiveOperationsInsights({ insights }) {
  const cards = []
  const salesDrivers = insights.sales_drivers_by_unit || []
  const laggingProducts = insights.lagging_products_by_unit || []
  if (salesDrivers.length) cards.push({ title: 'Selling Most by Unit', tone: 'orange', text: salesDrivers.map((product) => `${product.product_name}: ${formatQuantity(product.quantity_sold)} ${product.unit}`).join(' · ') })
  if (laggingProducts.length) cards.push({ title: 'Selling Least by Unit', tone: 'danger', text: laggingProducts.map((product) => `${product.product_name}: ${formatQuantity(product.quantity_sold)} ${product.unit}`).join(' · ') })
  if (insights.procurement_priority) cards.push({ title: 'Restock First', tone: 'warning', text: <><strong>{insights.procurement_priority.product_name}</strong> should be restocked first. Stock: <em>{formatQuantity(insights.procurement_priority.current_stock)} {insights.procurement_priority.unit}</em>. Reorder at: {formatQuantity(insights.procurement_priority.reorder_level)} {insights.procurement_priority.unit}.</> })
  return (
    <article className="panel executive-insights">
      <h2><Lightbulb size={17} aria-hidden="true" />BUSINESS SUMMARY</h2>
      {!cards.length ? <EmptyState>No operational insights available.</EmptyState> : <div>{cards.map((card) => <section className={card.tone} key={card.title}><h3>{card.title}</h3><p>{card.text}</p></section>)}</div>}
    </article>
  )
}

export default ExecutiveOperationsInsights
