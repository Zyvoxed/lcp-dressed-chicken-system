import EmptyState from '../Shared/EmptyState.jsx'

function LowSellingProducts({ products }) {
  return (
    <article className="panel dashboard-list-panel low-selling-panel">
      <header><h2>LOW SELLING PRODUCTS</h2><span className="dashboard-badge danger">LOWEST 5</span></header>
      {!products.length ? <EmptyState>No active products found.</EmptyState> : <div className="dashboard-ranked-list">
        {products.map((product) => <div className="dashboard-product-row low" key={product.product_id}><div><strong>{product.product_name}</strong><span>{Number(product.quantity_sold)} {product.unit} sold</span></div><div><em>{Number(product.stock_quantity)} {product.unit}</em><b>LOW DEMAND</b></div></div>)}
      </div>}
    </article>
  )
}

export default LowSellingProducts
