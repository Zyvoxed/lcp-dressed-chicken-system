import { useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import { peso } from '../../utils/currency.js'
import {
  formatQuantityInput,
  validateQuantityEntry,
} from './quantityInput.js'

function QuantityModal({ product, mode, initialValue, currentQuantity = 0, onClose, onConfirm }) {
  const [quantityValue, setQuantityValue] = useState(initialValue)
  const [error, setError] = useState('')
  const unit = product.unit || 'kg'
  const isEditing = mode === 'edit'

  function submitQuantity(event) {
    event.preventDefault()
    const result = validateQuantityEntry({
      value: quantityValue,
      stockQuantity: product.stock_quantity,
      currentQuantity,
      mode,
      unit,
    })

    if (result.error) {
      setError(result.error)
      return
    }

    onConfirm(result.quantityThousandths)
  }

  return (
    <Modal
      title={isEditing ? 'Edit Cart Quantity' : 'Add Product Quantity'}
      onClose={onClose}
      className="quantity-entry-modal"
    >
      <form className="quantity-entry-form" onSubmit={submitQuantity}>
        <div className="quantity-entry-product">
          <strong>{product.product_name}</strong>
          <span>{peso.format(Number(product.selling_price))} / {unit}</span>
          <span>Available stock: {formatQuantityInput(product.stock_quantity)} {unit}</span>
          {mode === 'add' && currentQuantity > 0 && (
            <span>
              Currently in cart: {formatQuantityInput(currentQuantity)} {unit}. The entered quantity will be added.
            </span>
          )}
        </div>

        <label className="quantity-entry-field" htmlFor="pos-quantity-entry">
          <span>Quantity ({unit})</span>
          <input
            id="pos-quantity-entry"
            name="quantity"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={quantityValue}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'pos-quantity-error' : undefined}
            onChange={(event) => {
              setQuantityValue(event.target.value)
              if (error) setError('')
            }}
          />
        </label>

        {error && <p className="quantity-entry-error" id="pos-quantity-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="submit">{isEditing ? 'Update Quantity' : 'Add to Cart'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default QuantityModal
