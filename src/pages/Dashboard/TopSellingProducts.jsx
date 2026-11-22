import { useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import { peso, quantity } from '../../utils/currency.js'
import { groupByUnit } from '../../utils/unitAwareMetrics.js'

const barColors = {
  top: '#235347',
  least: '#8EB69B',
}

function ProductBar({ product, maximum, mode }) {
  const sold = Number(product.quantity_sold) || 0
  const width = maximum > 0 ? `${(Math.max(sold, 0) / maximum) * 100}%` : '0%'

  return (
    <div className={`dashboard-performance-row ${mode === 'least' ? 'least' : ''}`}>
      <div className="dashboard-performance-heading">
        <strong>{product.product_name}</strong>
        <span>{quantity.format(sold)} {product.unit || 'Unspecified unit'}</span>
      </div>
      <div className="dashboard-performance-track" aria-label={`${quantity.format(sold)} ${product.unit || 'Unspecified unit'} sold`}>
        <span style={{ width, backgroundColor: barColors[mode] }} />
      </div>
      {mode === 'least' && <span className="dashboard-performance-status">LOW DEMAND</span>}
      {mode === 'top' && product.sales_amount != null && (
        <span className="dashboard-performance-revenue">{peso.format(Number(product.sales_amount))}</span>
      )}
    </div>
  )
}

function TopSellingProducts({ products = [], leastProducts = [] }) {
  const [mode, setMode] = useState('top')
  const productGroups = groupByUnit(mode === 'top' ? products : leastProducts)

  return (
    <article className="panel dashboard-list-panel dashboard-performance-panel">
      <header>
        <h2>Product Performance</h2>
        <div className="dashboard-segments dashboard-performance-toggle" role="group" aria-label="Product performance ranking">
          <button type="button" className={mode === 'top' ? 'active' : ''} aria-pressed={mode === 'top'} onClick={() => setMode('top')}>Top 5</button>
          <button type="button" className={mode === 'least' ? 'active' : ''} aria-pressed={mode === 'least'} onClick={() => setMode('least')}>Least 5</button>
        </div>
      </header>
      {!productGroups.length ? (
        <EmptyState>{mode === 'top' ? 'No product sales recorded.' : 'No active products found.'}</EmptyState>
      ) : (
        <div className={`dashboard-performance-list ${mode === 'least' ? 'least' : 'top'}`} key={mode}>
          {productGroups.map(({ unit, items }) => {
            const unitProducts = items.slice(0, 5)
            const maximum = Math.max(...unitProducts.map((product) => Math.max(Number(product.quantity_sold) || 0, 0)), 0)
            return (
              <section className="dashboard-performance-unit-group" key={unit} aria-label={`${mode === 'top' ? 'Top' : 'Least'} products in ${unit}`}>
                <h3>{mode === 'top' ? 'Top' : 'Least'} 5 in {unit}</h3>
                {unitProducts.map((product) => (
                  <ProductBar key={product.product_id} product={product} maximum={maximum} mode={mode} />
                ))}
              </section>
            )
          })}
        </div>
      )}
    </article>
  )
}

export default TopSellingProducts
