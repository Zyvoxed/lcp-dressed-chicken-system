import { useEffect, useRef, useState } from 'react'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import { getProducts } from '../../services/productService.js'
import { getSuppliers } from '../../services/supplierService.js'
import { createStockIn } from '../../services/stockInService.js'
import { peso } from '../../utils/currency.js'
import StockInConfirmationModal from './StockInConfirmationModal.jsx'

function getLocalDateTime() {
  const now = new Date()
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return localTime.toISOString().slice(0, 16)
}

function createInitialForm() {
  return {
    supplier_id: '',
    product_id: '',
    quantity_received: '',
    cost_price: '',
    delivery_date: getLocalDateTime(),
  }
}

function validateStockIn(form, product, supplier) {
  if (!supplier) return 'Select a supplier.'
  if (!product) return 'Select a product.'

  const quantity = Number(form.quantity_received)
  if (form.quantity_received === '' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999999.999) {
    return 'Quantity received must be greater than zero.'
  }

  const costPrice = Number(form.cost_price)
  if (form.cost_price === '' || !Number.isFinite(costPrice) || costPrice < 0 || costPrice > 99999999.99) {
    return 'Cost per unit must be a valid non-negative amount.'
  }

  if (!form.delivery_date || Number.isNaN(new Date(form.delivery_date).getTime())) {
    return 'Enter a valid delivery date and time.'
  }

  return ''
}

function StockInForm({ onCreated }) {
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(createInitialForm)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [successResult, setSuccessResult] = useState(null)
  const [refreshWarning, setRefreshWarning] = useState('')
  const [error, setError] = useState('')
  const submissionLock = useRef(false)
  const selectedProduct = products.find((product) => String(product.product_id) === String(form.product_id))
  const selectedSupplier = suppliers.find((supplier) => String(supplier.supplier_id) === String(form.supplier_id))

  useEffect(() => {
    const controller = new AbortController()

    async function loadOptions() {
      try {
        const [productData, supplierData] = await Promise.all([
          getProducts({ signal: controller.signal }),
          getSuppliers({ signal: controller.signal }),
        ])
        setProducts(productData)
        setSuppliers(supplierData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadOptions()
    return () => controller.abort()
  }, [])

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
  }

  function handleReview(event) {
    event.preventDefault()
    const validationError = validateStockIn(form, selectedProduct, selectedSupplier)
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    setConfirmationOpen(true)
  }

  async function confirmStockIn() {
    if (submissionLock.current) return
    submissionLock.current = true
    setSubmitting(true)
    setError('')
    setRefreshWarning('')

    try {
      const result = await createStockIn(form)
      setSuccessResult({ ...result, product: selectedProduct, supplier: selectedSupplier })
      setConfirmationOpen(false)
      onCreated()
      try {
        setProducts(await getProducts())
      } catch (refreshError) {
        setRefreshWarning(`Delivery recorded, but stock figures could not be refreshed: ${refreshError.message}`)
      }
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  function finishStockIn() {
    setSuccessResult(null)
    setRefreshWarning('')
    setError('')
    setForm((current) => ({
      ...createInitialForm(),
      supplier_id: current.supplier_id,
      product_id: current.product_id,
    }))
  }

  const successDetails = successResult ? [
    { label: 'Delivery reference', value: `DLV-${successResult.stockin_id}` },
    { label: 'Product', value: successResult.product.product_name },
    { label: 'Supplier', value: successResult.supplier.supplier_name },
    { label: 'Quantity received', value: `${Number(successResult.quantity_received)} ${successResult.product.unit}` },
    { label: 'Cost per unit', value: peso.format(Number(successResult.cost_price)) },
    { label: 'Total cost', value: peso.format(Number(successResult.total_cost)) },
  ] : []

  return (
    <form className="panel centered-form inventory-stock-form" onSubmit={handleReview} noValidate aria-busy={loading || submitting}>
      <div className="inventory-form-heading">
        <h2>Record Stock Delivery</h2>
        <p>Create a FIFO inventory batch from a confirmed supplier delivery.</p>
      </div>
      <div className="inventory-stock-form-grid">
        <label>
          <span>Supplier <b className="required-marker" aria-hidden="true">*</b></span>
          <select name="supplier_id" value={form.supplier_id} onChange={handleChange} required disabled={loading || submitting}>
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => <option key={supplier.supplier_id} value={supplier.supplier_id}>{supplier.supplier_name}</option>)}
          </select>
        </label>
        <label>
          <span>Product <b className="required-marker" aria-hidden="true">*</b></span>
          <select name="product_id" value={form.product_id} onChange={handleChange} required disabled={loading || submitting}>
            <option value="">Select product</option>
            {products.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name}</option>)}
          </select>
        </label>
      </div>
      {selectedProduct && (
        <div className="selected-stock-summary">
          <div>
            <span>Current stock</span>
            <strong>{Number(selectedProduct.stock_quantity)} {selectedProduct.unit}</strong>
          </div>
          <div>
            <span>Reorder level</span>
            <strong>{Number(selectedProduct.reorder_level)} {selectedProduct.unit}</strong>
          </div>
          <StatusBadge value={selectedProduct.status} />
        </div>
      )}
      <div className="inventory-stock-form-grid">
        <label>
          <span>Quantity Received{selectedProduct ? ` (${selectedProduct.unit})` : ''} <b className="required-marker" aria-hidden="true">*</b></span>
          <input name="quantity_received" type="number" inputMode="decimal" min="0.001" max="9999999.999" step="0.001" placeholder="0" value={form.quantity_received} onChange={handleChange} required disabled={loading || submitting} />
        </label>
        <label>
          <span>Cost per Unit <b className="required-marker" aria-hidden="true">*</b></span>
          <input name="cost_price" type="number" inputMode="decimal" min="0" max="99999999.99" step="0.01" placeholder="0.00" value={form.cost_price} onChange={handleChange} required disabled={loading || submitting} />
        </label>
      </div>
      <label>
        <span>Delivery Date and Time <b className="required-marker" aria-hidden="true">*</b></span>
        <input name="delivery_date" type="datetime-local" value={form.delivery_date} onChange={handleChange} required disabled={loading || submitting} />
      </label>
      {loading && <LoadingSpinner />}
      {error && !confirmationOpen && <p className="inventory-feedback error" role="alert">{error}</p>}
      <button className="primary-action" type="submit" disabled={loading || submitting}>
        Review Stock Delivery
      </button>
      {confirmationOpen && (
        <StockInConfirmationModal
          product={selectedProduct}
          supplier={selectedSupplier}
          form={form}
          submitting={submitting}
          error={error}
          onCancel={() => { if (!submitting) { setConfirmationOpen(false); setError('') } }}
          onConfirm={confirmStockIn}
        />
      )}
      {successResult && (
        <TransactionSuccessModal
          title="Stock In Recorded Successfully!"
          message="The supplier delivery has been recorded and added to inventory successfully."
          details={successDetails}
          notice={refreshWarning}
          onDone={finishStockIn}
        />
      )}
    </form>
  )
}

export default StockInForm
