import StatusBadge from '../Shared/StatusBadge.jsx'
import { peso } from '../../utils/currency.js'

function ProductCard({ product, onAdd }) {
  const available = Number(product.stock_quantity) > 0

  function handleKeyDown(event) {
    if (available && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onAdd(product)
    }
  }

  return (
    <article
      className="product-card"
      role="button"
      tabIndex={available ? 0 : -1}
      aria-disabled={!available}
      onClick={() => available && onAdd(product)}
      onKeyDown={handleKeyDown}
    >
      <span>{product.category}</span>
      <h3>{product.product_name}</h3>
      <p>Available stock: {Number(product.stock_quantity)} {product.unit}</p>
      <strong>{peso.format(Number(product.selling_price))} / {product.unit}</strong>
      <StatusBadge value={product.status} as="em" />
    </article>
  )
}

export default ProductCard
