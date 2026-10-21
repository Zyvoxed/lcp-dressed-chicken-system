import { Lightbulb } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function ExecutiveOperationsInsights({ insights }) {
  const cards = []
  if (insights.sales_driver) cards.push({ title: 'Selling Most', tone: 'orange', text: <><strong>{insights.sales_driver.product_name}</strong> sold the most: <em>{formatQuantity(insights.sales_driver.quantity_sold)} {insights.sales_driver.unit}</em>.</> })
  if (insights.lagging_product) cards.push({ title: 'Selling Least', tone: 'danger', text: <><strong>{insights.lagging_product.product_name}</strong> sold the least: <em>{formatQuantity(insights.lagging_product.quantity_sold)} {insights.lagging_product.unit}</em>.</> })
  if (insights.procurement_priority) cards.push({ title: 'Restock First', tone: 'warning', text: <><strong>{insights.procurement_priority.product_name}</strong> should be restocked first. Stock: <em>{formatQuantity(insights.procurement_priority.current_stock)} {insights.procurement_priority.unit}</em>. Reorder at: {formatQuantity(insights.procurement_priority.reorder_level)} {insights.procurement_priority.unit}.</> })
  return (
    <article className="panel executive-insights">
      <h2><Lightbulb size={17} aria-hidden="true" />BUSINESS SUMMARY</h2>
      {!cards.length ? <EmptyState>No operational insights available.</EmptyState> : <div>{cards.map((card) => <section className={card.tone} key={card.title}><h3><span aria-hidden="true" />{card.title}</h3><p>{card.text}</p></section>)}</div>}
    </article>
  )
}

export default ExecutiveOperationsInsights
