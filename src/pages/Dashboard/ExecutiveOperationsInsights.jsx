import { Lightbulb } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
function ExecutiveOperationsInsights({ insights }) {
  const cards = []
  if (insights.sales_driver) cards.push({ title: 'Top-Selling Product', tone: 'orange', text: <><strong>{insights.sales_driver.product_name}</strong> has the highest quantity sold at <em>{Number(insights.sales_driver.quantity_sold)} {insights.sales_driver.unit}</em>. Keep enough stock available.</> })
  if (insights.lagging_product) cards.push({ title: 'Slow-Selling Product', tone: 'danger', text: <><strong>{insights.lagging_product.product_name}</strong> has the lowest quantity sold at <em>{Number(insights.lagging_product.quantity_sold)} {insights.lagging_product.unit}</em>. Review its stock and customer demand.</> })
  if (insights.procurement_priority) cards.push({ title: 'Product to Restock First', tone: 'warning', text: <><strong>{insights.procurement_priority.product_name}</strong> is below its low-stock level. Current stock: <em>{Number(insights.procurement_priority.current_stock)} {insights.procurement_priority.unit}</em>. Low stock level: {Number(insights.procurement_priority.reorder_level)} {insights.procurement_priority.unit}.</> })
  return <article className="panel executive-insights"><h2><Lightbulb size={17} />EXECUTIVE OPERATIONS INSIGHTS</h2>{!cards.length ? <EmptyState>No operational insights available.</EmptyState> : <div>{cards.map((card) => <section className={card.tone} key={card.title}><h3>● {card.title}</h3><p>{card.text}</p></section>)}</div>}</article>
}
export default ExecutiveOperationsInsights
