import { AlertTriangle } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function RestockWarnings({ products }) {
  return (
    <article className="panel analytics-restock-panel">
      <header><div><h2><AlertTriangle size={17} aria-hidden="true" />LOW STOCK</h2></div><b>{products.length} item{products.length === 1 ? '' : 's'}</b></header>
      {!products.length ? <EmptyState>No products currently require restocking.</EmptyState> : (
        <div className="analytics-scroll-list">
          {products.map((product) => <div className="analytics-restock-row" key={product.product_id}><div><strong>{product.product_name}</strong><p>Stock: <em>{formatQuantity(product.current_stock)} {product.unit}</em></p></div><div><b>RESTOCK</b><span>Reorder at: {formatQuantity(product.reorder_level)} {product.unit}</span></div></div>)}
        </div>
      )}
    </article>
  )
}

export default RestockWarnings
