import EmptyState from '../Shared/EmptyState.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { quantity } from '../../utils/currency.js'

function RestockChecklist({ products, total }) {
  return (
    <article className="panel dashboard-list-panel dashboard-restock-panel">
      <header><h2>LOW STOCK ALERTS</h2><span className="dashboard-badge danger">{total} ALERTS</span></header>
      {!products.length ? <EmptyState>No products require restocking.</EmptyState> : <div className="dashboard-ranked-list dashboard-restock-list">
        {products.slice(0, 5).map((product) => (
          <div className="dashboard-stock-row" key={product.product_id}>
            <div className="dashboard-stock-copy">
              <strong>{product.product_name}</strong>
              <p>
                Stock: <em>{quantity.format(Number(product.stock_quantity))} {product.unit}</em>
                <span className="dashboard-stock-detail-separator"> · </span>
                Low Stock Level: {quantity.format(Number(product.reorder_level))} {product.unit}
              </p>
            </div>
            <StatusBadge value={product.status || 'Low Stock'} />
          </div>
        ))}
      </div>}
    </article>
  )
}

export default RestockChecklist
