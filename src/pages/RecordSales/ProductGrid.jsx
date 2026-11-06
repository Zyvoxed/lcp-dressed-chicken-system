import ProductCard from './ProductCard.jsx'

function ProductGrid({ products, onAdd }) {
  return (
    <div className="pos-product-table-wrap" role="region" aria-label="Product catalog" tabIndex={0}>
      <table className="pos-product-table">
        <thead>
          <tr>
            <th scope="col">Product Name</th>
            <th scope="col">Selling Price</th>
            <th scope="col">Unit</th>
            <th scope="col">Available Stock</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <ProductCard key={product.product_id} product={product} onAdd={onAdd} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ProductGrid
