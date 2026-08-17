import { Lightbulb } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
function ExecutiveOperationsInsights({ insights }) {
  const cards = []
  if (insights.sales_driver) cards.push({ title: 'Primary Sales Driver', tone: 'orange', text: <><strong>{insights.sales_driver.product_name}</strong> is currently leading sales with an aggregate volume of <em>{Number(insights.sales_driver.quantity_sold)} {insights.sales_driver.unit}</em>. Ensure inventory availability remains sufficient.</> })
  if (insights.lagging_product) cards.push({ title: 'Lagging Demand Warning', tone: 'danger', text: <><strong>{insights.lagging_product.product_name}</strong> currently has the lowest recorded movement at <em>{Number(insights.lagging_product.quantity_sold)} {insights.lagging_product.unit}</em>. Review stocking levels and sales demand.</> })
  if (insights.procurement_priority) cards.push({ title: 'Procurement Priority Alert', tone: 'warning', text: <><strong>{insights.procurement_priority.product_name}</strong> is below its configured safe stock threshold. Current stock is <em>{Number(insights.procurement_priority.current_stock)} {insights.procurement_priority.unit}</em> against a reorder level of {Number(insights.procurement_priority.reorder_level)} {insights.procurement_priority.unit}.</> })
  return <article className="panel executive-insights"><h2><Lightbulb size={17} />EXECUTIVE OPERATIONS INSIGHTS</h2>{!cards.length ? <EmptyState>No operational insights available.</EmptyState> : <div>{cards.map((card) => <section className={card.tone} key={card.title}><h3>● {card.title}</h3><p>{card.text}</p></section>)}</div>}</article>
}
export default ExecutiveOperationsInsights
