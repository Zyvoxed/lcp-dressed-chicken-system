import { TrendingDown, TrendingUp } from 'lucide-react'
import { peso } from '../../utils/currency.js'
import EmptyState from '../Shared/EmptyState.jsx'
import { groupByUnit } from '../../utils/unitAwareMetrics.js'

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function ProductPerformanceLists({ title, products, mode }) {
  const Icon = mode === 'top' ? TrendingUp : TrendingDown
  const productGroups = groupByUnit(products)
  return (
    <article className={`panel analytics-performance-list ${mode}`}>
      <h2><Icon size={16} aria-hidden="true" />{title}</h2>
      {!productGroups.length ? <EmptyState>{mode === 'top' ? 'No product sales data yet.' : 'No active products found.'}</EmptyState> : (
        <div className="analytics-scroll-list">
          {productGroups.map(({ unit, items }) => (
            <section className="analytics-unit-group" key={unit} aria-label={`${title} in ${unit}`}>
              <h3>{unit}</h3>
              {items.slice(0, 5).map((product, index) => (
                <div className="analytics-performance-row" key={product.product_id}>
                  <span className="analytics-rank" aria-label={`Rank ${index + 1} in ${unit}`}>{index + 1}</span>
                  <div><strong>{product.product_name}</strong><p>Sold: <em>{formatQuantity(product.quantity_sold)} {product.unit}</em></p></div>
                  {mode === 'top' ? <div><b>{peso.format(Number(product.gross_sales))}</b><span>Gross Sales</span></div> : <div><b className="low-demand">LOW SALES</b><span>Stock: {formatQuantity(product.current_stock)} {product.unit}</span></div>}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </article>
  )
}

export default ProductPerformanceLists
