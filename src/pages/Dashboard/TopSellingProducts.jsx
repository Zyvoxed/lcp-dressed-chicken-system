import EmptyState from '../Shared/EmptyState.jsx'
import { peso } from '../../utils/currency.js'

function TopSellingProducts({ products }) {
  return (
    <article className="panel dashboard-list-panel">
      <header><h2>TOP SELLING PRODUCTS</h2><span className="dashboard-badge">TOP 5</span></header>
      {!products.length ? <EmptyState>No product sales recorded.</EmptyState> : <div className="dashboard-ranked-list">
        {products.map((product) => <div className="dashboard-product-row" key={product.product_id}><div><strong>{product.product_name}</strong><span>{Number(product.quantity_sold)} {product.unit} sold</span></div><em>{peso.format(Number(product.sales_amount))}</em></div>)}
      </div>}
    </article>
  )
}

export default TopSellingProducts
