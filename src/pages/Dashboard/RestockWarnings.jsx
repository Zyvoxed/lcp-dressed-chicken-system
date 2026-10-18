import { AlertTriangle, Lightbulb } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
function RestockWarnings({ products }) {
  return <article className="panel analytics-restock-panel"><header><h2><AlertTriangle size={17} />LOW STOCK ALERTS</h2><b>{products.length} alerts</b></header>{!products.length ? <EmptyState>No restock alerts.</EmptyState> : <div className="analytics-scroll-list">{products.map((product) => <div className="analytics-restock-row" key={product.product_id}><strong>{product.product_name}</strong><p>Stock: <em>{Number(product.current_stock)} {product.unit}</em> <span>Low Stock Level: {Number(product.reorder_level)} {product.unit}</span></p><b>RESTOCK NEEDED</b></div>)}</div>}<footer><Lightbulb size={14} />Stock updates when sales and deliveries are recorded.</footer></article>
}
export default RestockWarnings
