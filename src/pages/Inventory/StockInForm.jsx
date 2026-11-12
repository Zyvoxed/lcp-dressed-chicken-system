import { useEffect, useRef, useState } from 'react'
import StatusBadge from '../Shared/StatusBadge.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import { getProducts } from '../../services/productService.js'
import { getSuppliers } from '../../services/supplierService.js'
import { createStockIn } from '../../services/stockInService.js'
import { peso } from '../../utils/currency.js'
import { createIdempotencyKey } from '../../utils/idempotency.js'
import { getIdempotencyStatus } from '../../services/idempotencyService.js'
import {
  clearPendingTransaction,
  readPendingTransaction,
  savePendingTransaction,
} from '../../utils/pendingTransaction.js'
import { transactionLineCents } from '../../utils/transactionMoney.js'
import StockInConfirmationModal from './StockInConfirmationModal.jsx'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../context/ToastContext.jsx'

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

  const quantityText = String(form.quantity_received).trim()
  const quantity = Number(quantityText)
  if (!/^\d+(?:\.\d{1,3})?$/.test(quantityText) || !Number.isFinite(quantity) || quantity <= 0) {
    return 'Quantity received must be greater than zero.'
  }
  if (quantity > 9999999.999) return 'Quantity received exceeds the supported maximum.'

  const costPriceText = String(form.cost_price).trim()
  const costPrice = Number(costPriceText)
  if (!/^\d+(?:\.\d{1,2})?$/.test(costPriceText) || !Number.isFinite(costPrice) || costPrice < 0) {
    return 'Cost per unit must be a valid non-negative amount.'
  }
  if (costPrice > 99999999.99) return 'Cost per unit exceeds the supported maximum.'

  if (transactionLineCents(quantityText, costPriceText) > 999999999999n) {
    return 'Total cost cannot exceed ₱9,999,999,999.99.'
  }

  if (!form.delivery_date || Number.isNaN(new Date(form.delivery_date).getTime())) {
    return 'Enter a valid delivery date and time.'
  }

  return ''
}

function createRecoveredStockInResult(data, attempt, products, suppliers) {
  const product = attempt.display.product
    || products.find((item) => item.product_id === data?.product_id)
  const supplier = attempt.display.supplier
    || suppliers.find((item) => item.supplier_id === data?.supplier_id)
  if (!data?.stockin_id || !product?.product_name || !supplier?.supplier_name) {
    throw new Error('The saved delivery result is incomplete. Keep the original attempt and contact an administrator before retrying.')
  }
  return { ...data, product, supplier }
}

function getInitialStockInRecovery(userId) {
  try {
    return { attempt: readPendingTransaction('stock_in', userId), error: '' }
  } catch (error) {
    return { attempt: null, error: error.message }
  }
}

function StockInForm({ onCreated }) {
  const { user } = useAuth()
  return <StockInFormForUser key={user?.user_id || 'unauthenticated'} userId={user?.user_id} onCreated={onCreated} />
}

function StockInFormForUser({ userId, onCreated }) {
  const { showSuccess, showError, showWarning } = useToast()
  const [initialRecovery] = useState(() => getInitialStockInRecovery(userId))
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(() => initialRecovery.attempt?.payload || createInitialForm())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [successResult, setSuccessResult] = useState(null)
  const [refreshWarning, setRefreshWarning] = useState('')
  const [error, setError] = useState('')
  const [pendingAttempt, setPendingAttempt] = useState(initialRecovery.attempt)
  const [recoveryMessage, setRecoveryMessage] = useState(initialRecovery.error)
  const [confirmEditRejected, setConfirmEditRejected] = useState(false)
  const submissionLock = useRef(false)
  const recoveryChecked = useRef(false)
  const selectedProduct = products.find((product) => String(product.product_id) === String(form.product_id))
    || pendingAttempt?.display?.product
  const selectedSupplier = suppliers.find((supplier) => String(supplier.supplier_id) === String(form.supplier_id))
    || pendingAttempt?.display?.supplier
  const recoveryBlocked = Boolean(recoveryMessage && !pendingAttempt)

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

  useEffect(() => {
    if (loading || !pendingAttempt || pendingAttempt.state === 'rejected' || recoveryChecked.current) return
    recoveryChecked.current = true
    let active = true

    async function recoverStockIn() {
      try {
        const status = await getIdempotencyStatus('stock_in', pendingAttempt.key)
        if (!active) return
        if (status.state === 'completed') {
          const result = createRecoveredStockInResult(
            status.response?.data,
            pendingAttempt,
            products,
            suppliers,
          )
          const completedAttempt = {
            ...pendingAttempt,
            state: 'completed',
            response: status.response.data,
          }
          savePendingTransaction('stock_in', userId, completedAttempt)
          setPendingAttempt(completedAttempt)
          setSuccessResult(result)
          showSuccess('The stock delivery was already recorded successfully.')
          setRecoveryMessage('The stock delivery was already recorded. Its original result is ready to review.')
        } else {
          setRecoveryMessage('No completed result was found. Retry the original delivery to safely recover or finish it.')
        }
      } catch (statusError) {
        if (active) setRecoveryMessage(`${statusError.message}. Retry the original delivery with its saved key.`)
      }
    }

    recoverStockIn()
    return () => { active = false }
  }, [loading, pendingAttempt, products, showSuccess, suppliers, userId])

  function handleChange(event) {
    if (pendingAttempt) return
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
  }

  function handleReview(event) {
    event.preventDefault()
    if (recoveryBlocked) return
    if (pendingAttempt) {
      if (pendingAttempt.state === 'rejected') return
      setError('')
      setConfirmationOpen(true)
      return
    }
    const validationError = validateStockIn(form, selectedProduct, selectedSupplier)
    if (validationError) {
      setError(validationError)
      showError(validationError)
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

    let attempt = pendingAttempt
    try {
      if (attempt?.state === 'rejected') return
      if (!attempt) {
        attempt = {
          key: createIdempotencyKey(),
          state: 'pending',
          payload: { ...form },
          display: {
            product: {
              product_id: selectedProduct.product_id,
              product_name: selectedProduct.product_name,
              unit: selectedProduct.unit,
              stock_quantity: selectedProduct.stock_quantity,
              reorder_level: selectedProduct.reorder_level,
              status: selectedProduct.status,
            },
            supplier: {
              supplier_id: selectedSupplier.supplier_id,
              supplier_name: selectedSupplier.supplier_name,
            },
          },
        }
      }
      savePendingTransaction('stock_in', userId, attempt)
      recoveryChecked.current = true
      setPendingAttempt(attempt)
      const result = await createStockIn(attempt.payload, attempt.key)
      const completedAttempt = { ...attempt, state: 'completed', response: result }
      savePendingTransaction('stock_in', userId, completedAttempt)
      setPendingAttempt(completedAttempt)
      setSuccessResult({ ...result, product: selectedProduct, supplier: selectedSupplier })
      showSuccess('Stock-in recorded successfully.')
      setConfirmationOpen(false)
      onCreated()
      try {
        setProducts(await getProducts())
      } catch (refreshError) {
        setRefreshWarning(`Delivery recorded, but stock figures could not be refreshed: ${refreshError.message}`)
        showWarning(`Delivery recorded, but stock figures could not be refreshed: ${refreshError.message}`)
      }
    } catch (requestError) {
      showError(requestError.message || 'Unable to record stock-in')
      setError(requestError.message)
      if (requestError.outcome === 'not_committed' && requestError.code === 'TRANSACTION_REJECTED' && attempt && attempt.state !== 'rejected') {
        setConfirmationOpen(false)
        const rejectedAttempt = {
          ...attempt,
          state: 'rejected',
          rejection: {
            status: requestError.status,
            code: requestError.code,
            outcome: requestError.outcome,
            message: requestError.message,
          },
        }
        try {
          savePendingTransaction('stock_in', userId, rejectedAttempt)
          setPendingAttempt(rejectedAttempt)
          setRecoveryMessage('This stock delivery was rejected and confirmed not committed. Edit or discard it before starting another delivery.')
        } catch (storageError) {
          setError(`${requestError.message}. ${storageError.message}`)
        }
      }
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  async function checkRecoveryStatus() {
    if (!pendingAttempt) return
    try {
      const status = await getIdempotencyStatus('stock_in', pendingAttempt.key)
      if (status.state === 'completed') {
        const result = createRecoveredStockInResult(
          status.response?.data,
          pendingAttempt,
          products,
          suppliers,
        )
        const completedAttempt = {
          ...pendingAttempt,
          state: 'completed',
          response: status.response.data,
        }
        savePendingTransaction('stock_in', userId, completedAttempt)
        setPendingAttempt(completedAttempt)
        setSuccessResult(result)
        showSuccess('Stock-in recorded successfully.')
        onCreated()
        try {
          setProducts(await getProducts())
          setRefreshWarning('')
        } catch (refreshError) {
          setRefreshWarning(`Delivery was recorded, but stock figures could not be refreshed: ${refreshError.message}`)
          showWarning(`Delivery was recorded, but stock figures could not be refreshed: ${refreshError.message}`)
        }
        setRecoveryMessage('The stock delivery was already recorded. Its original result is ready to review.')
      } else {
        setRecoveryMessage('No completed result was found. Retry the original delivery to safely recover or finish it.')
      }
    } catch (statusError) {
      setRecoveryMessage(`${statusError.message}. The saved key is unchanged.`)
    }
  }

  function finishStockIn() {
    try {
      clearPendingTransaction('stock_in', userId)
    } catch (storageError) {
      setError(storageError.message)
      return
    }

    setSuccessResult(null)
    setPendingAttempt(null)
    recoveryChecked.current = false
    setRefreshWarning('')
    setError('')
    setRecoveryMessage('')
    setForm((current) => ({
      ...createInitialForm(),
      supplier_id: current.supplier_id,
      product_id: current.product_id,
    }))
  }

  function editRejectedStockIn() {
    try {
      clearPendingTransaction('stock_in', userId)
    } catch (storageError) {
      setError(storageError.message)
      return
    }
    setPendingAttempt(null)
    setConfirmEditRejected(false)
    setConfirmationOpen(false)
    setRecoveryMessage('')
    setError('')
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
      </div>
      {pendingAttempt?.state === 'pending' && (
        <div className="inventory-feedback" role="status">
          <p>A stock delivery is unresolved. Its original details are locked to prevent duplicate or changed submissions.</p>
          <p>{recoveryMessage || 'Retry the original delivery to recover or finish it.'}</p>
          <button className="secondary-action" type="button" onClick={checkRecoveryStatus} disabled={submitting}>
            Check transaction status
          </button>
        </div>
      )}
      {pendingAttempt?.state === 'rejected' && (
        <div className="inventory-feedback error" role="status">
          <p>This delivery was rejected and confirmed not committed. Its original details remain saved until you choose to edit it.</p>
          {!confirmEditRejected ? (
            <button className="secondary-action" type="button" onClick={() => setConfirmEditRejected(true)} disabled={submitting}>
              Edit Rejected Delivery
            </button>
          ) : (
            <div className="confirmation-actions">
              <span>Clear this rejected attempt? The next submission will use a new key.</span>
              <button className="secondary-action" type="button" onClick={editRejectedStockIn}>Confirm Edit</button>
              <button className="secondary-action" type="button" onClick={() => setConfirmEditRejected(false)}>Keep Attempt</button>
            </div>
          )}
        </div>
      )}
      {recoveryMessage && !pendingAttempt && <p className="inventory-feedback error" role="alert">{recoveryMessage}</p>}
      {loading ? (
        <PageSkeleton variant="inventory-form" label="supplier and product options" />
      ) : (
        <div className="inventory-stock-form-grid">
          <label>
            <span>Supplier <b className="required-marker" aria-hidden="true">*</b></span>
            <select name="supplier_id" value={form.supplier_id} onChange={handleChange} required disabled={submitting || Boolean(pendingAttempt) || recoveryBlocked}>
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => <option key={supplier.supplier_id} value={supplier.supplier_id}>{supplier.supplier_name}</option>)}
            </select>
          </label>
          <label>
            <span>Product <b className="required-marker" aria-hidden="true">*</b></span>
            <select name="product_id" value={form.product_id} onChange={handleChange} required disabled={submitting || Boolean(pendingAttempt) || recoveryBlocked}>
              <option value="">Select product</option>
              {products.map((product) => <option key={product.product_id} value={product.product_id}>{product.product_name}</option>)}
            </select>
          </label>
        </div>
      )}
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
          <input name="quantity_received" type="number" inputMode="decimal" min="0.001" max="9999999.999" step="0.001" placeholder="0" value={form.quantity_received} onChange={handleChange} required disabled={loading || submitting || Boolean(pendingAttempt) || recoveryBlocked} />
        </label>
        <label>
          <span>Cost per Unit <b className="required-marker" aria-hidden="true">*</b></span>
          <input name="cost_price" type="number" inputMode="decimal" min="0" max="99999999.99" step="0.01" placeholder="0.00" value={form.cost_price} onChange={handleChange} required disabled={loading || submitting || Boolean(pendingAttempt) || recoveryBlocked} />
        </label>
      </div>
      <label>
        <span>Delivery Date and Time <b className="required-marker" aria-hidden="true">*</b></span>
        <input name="delivery_date" type="datetime-local" value={form.delivery_date} onChange={handleChange} required disabled={loading || submitting || Boolean(pendingAttempt) || recoveryBlocked} />
      </label>
      {error && !confirmationOpen && <p className="inventory-feedback error" role="alert">{error}</p>}
      <button className="primary-action" type="submit" disabled={loading || submitting || recoveryBlocked || Boolean(successResult) || pendingAttempt?.state === 'completed' || pendingAttempt?.state === 'rejected'}>
        {pendingAttempt?.state === 'pending' ? 'Retry Pending Delivery' : 'Review Stock Delivery'}
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
import PageSkeleton from '../Shared/PageSkeleton.jsx'
