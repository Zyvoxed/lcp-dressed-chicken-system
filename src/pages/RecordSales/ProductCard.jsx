import { Plus } from 'lucide-react'
import { peso } from '../../utils/currency.js'

function ProductCard({ product, onAdd }) {
  const available = Number(product.stock_quantity) > 0

  function addOnKeyboard(event) {
    if (available && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onAdd(product)
    }
  }

  return (
    <tr
      className="product-card"
      tabIndex={available ? 0 : -1}
      aria-disabled={!available}
      onClick={() => available && onAdd(product)}
      onKeyDown={addOnKeyboard}
    >
      <td className="pos-product-name">{product.product_name}</td>
      <td className="pos-product-price">{peso.format(Number(product.selling_price))}</td>
      <td>{product.unit}</td>
      <td>
        <span className={`pos-stock-status ${available ? 'available' : 'unavailable'}`}>
          {available ? `${Number(product.stock_quantity)} ${product.unit}` : 'Out of stock'}
        </span>
      </td>
      <td>
        <button
          className="pos-add-product"
          type="button"
          disabled={!available}
          onClick={(event) => {
            event.stopPropagation()
            onAdd(product)
          }}
          aria-label={`Add ${product.product_name} to current sale`}
        >
          <Plus size={15} aria-hidden="true" />
          <span className="pos-add-label">Add</span>
        </button>
      </td>
    </tr>
  )
}

export default ProductCard
