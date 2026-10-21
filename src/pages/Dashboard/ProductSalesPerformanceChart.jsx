import { BarChart3 } from 'lucide-react'
import { peso } from '../../utils/currency.js'
import EmptyState from '../Shared/EmptyState.jsx'

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function ProductSalesPerformanceChart({ products }) {
  const chartProducts = products.filter((product) => Number(product.quantity_sold) > 0)
  const maximum = Math.max(...chartProducts.map((product) => Number(product.quantity_sold)), 1)
  const midpoint = maximum / 2
  return (
    <article className="panel product-performance-chart">
      <header>
        <div><h2><BarChart3 size={17} aria-hidden="true" />PRODUCT SALES</h2></div>
        <span>QUANTITY SOLD</span>
      </header>
      {!chartProducts.length ? <EmptyState>No product sales data yet.</EmptyState> : (
        <div className="analytics-chart-layout">
          <div className="analytics-y-axis" aria-hidden="true"><span>{formatQuantity(maximum)}</span><span>{formatQuantity(midpoint)}</span><span>0</span></div>
          <div className="analytics-chart-scroll">
            <div className="analytics-bar-chart" role="group" aria-label="Product sales volume chart. Use Tab to inspect each product." style={{ '--analytics-product-count': chartProducts.length }}>
              {chartProducts.map((product, index) => {
                const quantitySold = Number(product.quantity_sold)
                const tooltip = `${product.product_name} | ${formatQuantity(quantitySold)} ${product.unit} sold | ${peso.format(Number(product.gross_sales))} gross sales`
                return (
                  <div className="analytics-bar-column" key={product.product_id} role="img" tabIndex={0} aria-label={tooltip} data-tooltip={tooltip} style={{ '--analytics-bar-color': `var(--chart-series-${(index % 5) + 1})` }}>
                    <span>{formatQuantity(quantitySold)}</span>
                    <div style={{ height: `${Math.max((quantitySold / maximum) * 100, 3)}%` }} />
                    <small title={product.product_name}>{product.product_name}</small>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

export default ProductSalesPerformanceChart
