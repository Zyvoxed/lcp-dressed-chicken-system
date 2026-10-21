import { TrendingDown, TrendingUp } from 'lucide-react'
import { peso } from '../../utils/currency.js'
import EmptyState from '../Shared/EmptyState.jsx'

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function ProductPerformanceLists({ title, products, mode }) {
  const Icon = mode === 'top' ? TrendingUp : TrendingDown
  return (
    <article className={`panel analytics-performance-list ${mode}`}>
      <h2><Icon size={16} aria-hidden="true" />{title}</h2>
      {!products.length ? <EmptyState>{mode === 'top' ? 'No product sales data yet.' : 'No active products found.'}</EmptyState> : (
        <div className="analytics-scroll-list">
          {products.map((product, index) => (
            <div className="analytics-performance-row" key={product.product_id}>
              <span className="analytics-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
              <div><strong>{product.product_name}</strong><p>Sold: <em>{formatQuantity(product.quantity_sold)} {product.unit}</em></p></div>
              {mode === 'top' ? <div><b>{peso.format(Number(product.gross_sales))}</b><span>Gross Sales</span></div> : <div><b className="low-demand">LOW SALES</b><span>Stock: {formatQuantity(product.current_stock)} {product.unit}</span></div>}
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

export default ProductPerformanceLists
