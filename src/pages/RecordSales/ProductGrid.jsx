import ProductCard from './ProductCard.jsx'

function ProductGrid({ products }) {
  return (
    <div className="product-grid">
      {products.map((product) => (
        <ProductCard key={product[0]} product={product} />
      ))}
    </div>
  )
}

export default ProductGrid
