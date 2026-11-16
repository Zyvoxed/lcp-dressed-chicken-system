import { Plus } from 'lucide-react'
import { peso } from '../../utils/currency.js'

function ProductCard({ product, onAdd }) {
  const stockQty = Number(product.stock_quantity) || 0
  const available = stockQty > 0
  const isLowStock = available && stockQty <= 10

  function addOnKeyboard(event) {
    if (available && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onAdd(product)
    }
  }

  return (
    <tr
      className={`product-card ${available ? 'is-available' : 'is-unavailable'}`}
      tabIndex={available ? 0 : -1}
      aria-disabled={!available}
      onClick={() => available && onAdd(product)}
      onKeyDown={addOnKeyboard}
    >
      <td className="pos-product-name-col">
        <div className="pos-prod-info">
          <strong className="pos-prod-name">{product.product_name}</strong>
          {product.category && <span className="pos-prod-cat-pill">{product.category}</span>}
        </div>
      </td>
      <td className="pos-product-price">
        <strong className="pos-price-num">{peso.format(Number(product.selling_price))}</strong>
      </td>
      <td className="pos-product-unit">
        <span className="pos-unit-tag">{product.unit || 'kg'}</span>
      </td>
      <td className="pos-product-stock">
        <span
          className={`pos-stock-badge ${
            !available ? 'out-of-stock' : isLowStock ? 'low-stock' : 'in-stock'
          }`}
        >
          <span className="stock-dot" aria-hidden="true" />
          <span>
            {available
              ? `${stockQty.toLocaleString('en-PH', { maximumFractionDigits: 1 })} ${product.unit || 'kg'}${
                  isLowStock ? ' (Low)' : ''
                }`
              : 'Out of stock'}
          </span>
        </span>
      </td>
      <td className="pos-product-action">
        <button
          className={`pos-add-product ${available ? 'available' : 'disabled'}`}
          type="button"
          disabled={!available}
          onClick={(event) => {
            event.stopPropagation()
            onAdd(product)
          }}
          aria-label={`Add ${product.product_name} to current sale`}
          title={available ? `Add ${product.product_name}` : 'Out of stock'}
        >
          <Plus size={14} aria-hidden="true" />
          <span className="pos-add-label">Add</span>
        </button>
      </td>
    </tr>
  )
}

export default ProductCard
