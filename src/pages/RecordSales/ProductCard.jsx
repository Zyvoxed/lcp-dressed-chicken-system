import StatusBadge from '../Shared/StatusBadge.jsx'
import { peso } from '../../utils/currency.js'

function ProductCard({ product }) {
  const [name, group, stock, price, status] = product

  return (
    <article className="product-card">
      <span>{group}</span>
      <h3>{name}</h3>
      <p>Available stock: {stock} kg</p>
      <strong>{peso.format(price)} / kg</strong>
      <StatusBadge value={status} as="em" />
    </article>
  )
}

export default ProductCard
