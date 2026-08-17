import { BarChart3 } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
function ProductSalesPerformanceChart({ products }) {
  const chartProducts = products.filter((product) => Number(product.quantity_sold) > 0)
  const maximum = Math.max(...chartProducts.map((product) => Number(product.quantity_sold)), 1)
  return <article className="panel product-performance-chart"><header><div><h2><BarChart3 size={17} />PRODUCT SALES PERFORMANCE OVERVIEW</h2><p>Distribution of total units sold per poultry listing</p></div><span>VOLUME DISTRIBUTION</span></header>{!chartProducts.length ? <EmptyState>No product sales data yet.</EmptyState> : <div className="analytics-bar-chart" role="img" aria-label="Product sales volume chart">{chartProducts.map((product, index) => <div className="analytics-bar-column" key={product.product_id}><span>{Number(product.quantity_sold)}</span><div className={index === 0 ? 'leading' : ''} style={{ height: `${Math.max(Number(product.quantity_sold) / maximum * 100, 3)}%` }} title={`${product.product_name}: ${Number(product.quantity_sold)} ${product.unit}`} /><small title={product.product_name}>{product.product_name}</small></div>)}</div>}</article>
}
export default ProductSalesPerformanceChart
