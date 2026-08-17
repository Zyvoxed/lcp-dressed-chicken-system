import { TrendingDown, TrendingUp } from 'lucide-react'
import { peso } from '../../utils/currency.js'
import EmptyState from '../Shared/EmptyState.jsx'
function ProductPerformanceLists({ title, products, mode }) {
  const Icon = mode === 'top' ? TrendingUp : TrendingDown
  return <article className={`panel analytics-performance-list ${mode}`}><h2><Icon size={16} />{title}</h2>{!products.length ? <EmptyState>{mode === 'top' ? 'No product sales data yet.' : 'No active products found.'}</EmptyState> : <div className="analytics-scroll-list">{products.map((product) => <div className="analytics-performance-row" key={product.product_id}><div><strong>{product.product_name}</strong><p>{mode === 'top' ? 'Quantity' : 'Sales Volume'}: <em>{Number(product.quantity_sold)} {product.unit}</em></p></div>{mode === 'top' ? <div><b>{peso.format(Number(product.gross_sales))}</b><span>Gross Sale</span></div> : <div><b className="low-demand">LOW DEMAND</b><span>Stock: {Number(product.current_stock)} {product.unit}</span></div>}</div>)}</div>}</article>
}
export default ProductPerformanceLists
