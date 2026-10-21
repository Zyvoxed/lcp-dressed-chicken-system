import { useRef, useState } from 'react'
import { createProduct, updateProduct } from '../../services/productService.js'
import { productCategories } from '../../utils/constants.js'
import { peso } from '../../utils/currency.js'
import Modal from '../Shared/Modal.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'

const initialForm = {
  product_name: '',
  category: '',
  unit: '',
  selling_price: '',
  reorder_level: '',
}

function toFormCategory(category = '') {
  const normalizedCategory = category.replace(/\s+and\s+/gi, ' & ')
  return productCategories.includes(normalizedCategory) ? normalizedCategory : category
}

function getInitialForm(product) {
  if (!product) return initialForm

  return {
    product_name: product.product_name ?? '',
    category: toFormCategory(product.category),
    unit: product.unit ?? '',
    selling_price: String(product.selling_price ?? ''),
    reorder_level: String(product.reorder_level ?? ''),
  }
}

function validateForm(form, includeUnit) {
  if (!form.product_name.trim()) return 'Product name is required.'
  if (form.product_name.trim().length > 100) return 'Product name must be 100 characters or fewer.'
  if (!productCategories.slice(1).includes(form.category)) return 'Select a supported category.'
  if (includeUnit && !form.unit.trim()) return 'Unit is required.'
  if (includeUnit && form.unit.trim().length > 20) return 'Unit must be 20 characters or fewer.'

  const sellingPrice = Number(form.selling_price)
  if (form.selling_price === '' || !Number.isFinite(sellingPrice) || sellingPrice < 0 || sellingPrice > 99999999.99) {
    return 'Selling price must be a valid non-negative amount.'
  }

  const reorderLevel = Number(form.reorder_level)
  if (form.reorder_level === '' || !Number.isFinite(reorderLevel) || reorderLevel < 0 || reorderLevel > 9999999.999) {
    return 'Reorder level must be a valid non-negative quantity.'
  }

  return ''
}

function ProductModal({ product, onClose, onSaved }) {
  const isEdit = Boolean(product)
  const [form, setForm] = useState(() => getInitialForm(product))
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [savedProduct, setSavedProduct] = useState(null)
  const submissionLock = useRef(false)

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (submissionLock.current) return

    const validationError = validateForm(form, !isEdit)
    if (validationError) {
      setError(validationError)
      return
    }

    submissionLock.current = true
    setSubmitting(true)
    setError('')

    try {
      const editableFields = {
        product_name: form.product_name.trim(),
        category: form.category,
        selling_price: Number(form.selling_price),
        reorder_level: Number(form.reorder_level),
      }
      const savedProduct = isEdit
        ? await updateProduct(product.product_id, editableFields)
        : await createProduct({ ...editableFields, unit: form.unit.trim() })
      setSavedProduct(savedProduct)
      onSaved(savedProduct, isEdit ? 'edit' : 'create')
    } catch (requestError) {
      setError(requestError.message)
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!submitting) onClose()
  }

  if (savedProduct) {
    return (
      <TransactionSuccessModal
        title={isEdit ? 'Product Updated Successfully!' : 'Product Added Successfully!'}
        message={isEdit
          ? 'The product information has been updated successfully.'
          : 'The product has been created with zero stock. Use Stock In to record inventory.'}
        details={[
          { label: 'Product reference', value: `PRD-${savedProduct.product_id}` },
          { label: 'Product name', value: savedProduct.product_name },
          { label: 'Category', value: savedProduct.category },
          { label: 'Selling price', value: peso.format(Number(savedProduct.selling_price)) },
          { label: 'Reorder level', value: `${Number(savedProduct.reorder_level)} ${savedProduct.unit}` },
          { label: 'Stock quantity', value: `${Number(savedProduct.stock_quantity)} ${savedProduct.unit}` },
        ]}
        onDone={onClose}
      />
    )
  }

  return (
    <Modal title={isEdit ? 'Edit Product' : 'Add Product'} onClose={handleClose}>
      <form className="inventory-product-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <label htmlFor="product-name">
          <span>Product Name <b className="required-marker" aria-hidden="true">*</b></span>
          <input
            id="product-name"
            name="product_name"
            value={form.product_name}
            onChange={handleChange}
            maxLength={100}
            autoComplete="off"
            required
          />
        </label>
        <label htmlFor="product-category">
          <span>Category <b className="required-marker" aria-hidden="true">*</b></span>
          <select
            id="product-category"
            name="category"
            value={form.category}
            onChange={handleChange}
            required
          >
            <option value="" disabled>Select a category</option>
            {productCategories.slice(1).map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        {isEdit ? (
          <label htmlFor="product-unit">
            Unit (cannot be changed)
            <input id="product-unit" value={form.unit} disabled />
          </label>
        ) : (
          <label htmlFor="product-unit">
            <span>Unit <b className="required-marker" aria-hidden="true">*</b></span>
            <input
              id="product-unit"
              name="unit"
              value={form.unit}
              onChange={handleChange}
              maxLength={20}
              placeholder="e.g. kg or piece"
              autoComplete="off"
              required
            />
          </label>
        )}
        <label htmlFor="product-selling-price">
          <span>Selling Price <b className="required-marker" aria-hidden="true">*</b></span>
          <input
            id="product-selling-price"
            name="selling_price"
            type="number"
            value={form.selling_price}
            onChange={handleChange}
            min="0"
            max="99999999.99"
            step="0.01"
            inputMode="decimal"
            required
          />
        </label>
        <label htmlFor="product-reorder-level">
          <span>Reorder Level <b className="required-marker" aria-hidden="true">*</b></span>
          <input
            id="product-reorder-level"
            name="reorder_level"
            type="number"
            value={form.reorder_level}
            onChange={handleChange}
            min="0"
            max="9999999.999"
            step="0.001"
            inputMode="decimal"
            required
          />
        </label>
        <p className="inventory-product-stock-note">
          {isEdit
            ? 'Unit, stock quantity, and stock history remain unchanged. Status is recalculated only when the low stock level changes.'
            : 'New products start with zero stock. Use Stock In to record opening inventory after creating the product.'}
        </p>
        {error && <p className="inventory-feedback error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={handleClose} disabled={submitting}>
            Cancel
          </button>
          <button className="primary-action" type="submit" disabled={submitting}>
            {submitting && <span className="inventory-submit-spinner" aria-hidden="true" />}
            {submitting ? (isEdit ? 'Saving Changes...' : 'Adding Product...') : (isEdit ? 'Save Changes' : 'Add Product')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default ProductModal
