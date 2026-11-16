import { useState } from 'react'
import { Medal, PackageOpen } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import { quantity } from '../../utils/currency.js'

const ranks = ['1st', '2nd', '3rd', '4th', '5th']

function HighestStockLevels({ products, loading, error }) {
  const [ranking, setRanking] = useState('highest')
  const isHighest = ranking === 'highest'
  const title = `Top 5 ${isHighest ? 'Highest' : 'Lowest'} Stock`
  const ranked = [...products]
    .sort((a, b) => (isHighest
      ? Number(b.stock_quantity) - Number(a.stock_quantity)
      : Number(a.stock_quantity) - Number(b.stock_quantity))
      || String(a.product_name).localeCompare(String(b.product_name)))
    .slice(0, 5)

  return (
    <article className="panel highest-stock-panel" aria-labelledby="highest-stock-title">
      <header className="highest-stock-heading">
        <div>
          <h2 id="highest-stock-title"><PackageOpen size={17} aria-hidden="true" /> {title}</h2>
          <p>{isHighest ? 'Products with the most' : 'Products with the least'} current stock</p>
        </div>
        <div className="stock-ranking-toggle" role="group" aria-label="Choose stock ranking">
          <button
            type="button"
            className={isHighest ? 'active' : ''}
            aria-pressed={isHighest}
            onClick={() => setRanking('highest')}
          >Top 5 Highest</button>
          <button
            type="button"
            className={!isHighest ? 'active' : ''}
            aria-pressed={!isHighest}
            onClick={() => setRanking('lowest')}
          >Top 5 Lowest</button>
        </div>
      </header>
      {loading ? <div className="highest-stock-loading" role="status">Loading current stock…</div>
        : error ? <EmptyState>Inventory stock levels are unavailable.</EmptyState>
          : ranked.length === 0 ? <EmptyState>No active inventory products available.</EmptyState>
            : <div className="highest-stock-grid">
              {ranked.map((product, index) => (
                <div className={`highest-stock-card${index === 0 ? ' leading' : ''}`} key={product.product_id}>
                  <span className="highest-stock-rank"><Medal size={14} aria-hidden="true" />{ranks[index]}</span>
                  <strong title={product.product_name}>{product.product_name}</strong>
                  <div className="highest-stock-quantity">
                    <b>{quantity.format(Number(product.stock_quantity))}</b>
                    <span>{product.unit || 'KG'}</span>
                  </div>
                </div>
              ))}
            </div>}
    </article>
  )
}

export default HighestStockLevels
