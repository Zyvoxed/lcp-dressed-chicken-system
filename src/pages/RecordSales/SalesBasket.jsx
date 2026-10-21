import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import CustomerSelector from './CustomerSelector.jsx'
import SaleConfirmationModal from './SaleConfirmationModal.jsx'
import { peso } from '../../utils/currency.js'

function SalesBasket({ cart, customers, customerId, onAddCustomer, onCustomerChange, onQuantity, onRemove, onProcess, onComplete }) {
  const [amountPaid, setAmountPaid] = useState('')
  const [paymentType, setPaymentType] = useState('Cash')
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [successResult, setSuccessResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submissionLock = useRef(false)
  const total = useMemo(() => cart.reduce(
    (sum, item) => sum + Number(item.selling_price) * item.quantity,
    0,
  ), [cart])
  const totalQuantity = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])
  const selectedCustomer = customers.find((customer) => String(customer.customer_id) === String(customerId))
  const customerName = selectedCustomer?.customer_name || 'Walk-In Customer'
  const numericAmountPaid = Number(amountPaid)
  const previewRemaining = Number.isFinite(numericAmountPaid) ? Math.max(total - numericAmountPaid, 0) : total

  function reviewSale() {
    setError('')
    if (!cart.length) return
    if (amountPaid.trim() === '' || !Number.isFinite(numericAmountPaid) || numericAmountPaid < 0) {
      setError('Enter a valid amount paid.')
      return
    }
    if (Math.round(numericAmountPaid * 100) > Math.round(total * 100)) {
      setError('Amount paid cannot exceed the sale total.')
      return
    }
    if (paymentType === 'Cash' && Math.round(numericAmountPaid * 100) !== Math.round(total * 100)) {
      setError('Cash payment must equal the full sale total.')
      return
    }
    if (paymentType === 'Credit' && !selectedCustomer) {
      setError('Select a customer for this credit sale.')
      return
    }
    setConfirmationOpen(true)
  }

  async function confirmSale() {
    if (submissionLock.current) return
    submissionLock.current = true
    setSubmitting(true)
    setError('')

    try {
      const result = await onProcess({ amountPaid: numericAmountPaid, paymentType, customerId })
      setConfirmationOpen(false)
      setSuccessResult({ ...result, customerName, paymentType })
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  function finishSale() {
    setSuccessResult(null)
    setAmountPaid('')
    setPaymentType('Cash')
    onCustomerChange('')
    setError('')
    onComplete()
  }

  const successDetails = successResult ? [
    { label: 'Transaction reference', value: `OR-${successResult.sale_id}` },
    { label: 'Customer', value: successResult.customerName },
    { label: 'Transaction total', value: peso.format(Number(successResult.total_amount)) },
    { label: 'Payment method', value: successResult.paymentType },
    { label: 'Amount paid', value: peso.format(Number(successResult.amount_paid)) },
    ...(Number(successResult.remaining_balance) > 0
      ? [{ label: 'Remaining balance', value: peso.format(Number(successResult.remaining_balance)) }]
      : []),
  ] : []

  return (
    <aside className="panel basket-panel" aria-busy={submitting}>
      <div className="basket-heading">
        <div>
          <span>TRANSACTION CART</span>
          <h2>Current Sale</h2>
        </div>
        <span>{cart.length} product{cart.length === 1 ? '' : 's'}</span>
      </div>

      {!cart.length && <EmptyState>Select an available product to start a sale.</EmptyState>}
      {cart.length > 0 && (
        <div className="basket-items" aria-label="Selected products">
          {cart.map((item) => {
            const atStockLimit = item.quantity >= Number(item.stock_quantity)
            return (
              <div className="basket-item" key={item.product_id}>
                <div className="basket-item-heading">
                  <div>
                    <strong>{item.product_name}</strong>
                    <span>{peso.format(Number(item.selling_price))} per {item.unit}</span>
                  </div>
                  <button className="basket-remove-button" type="button" disabled={submitting} onClick={() => onRemove(item.product_id)} aria-label={`Remove ${item.product_name}`}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="basket-item-controls">
                  <div className="quantity-stepper">
                    <button type="button" disabled={submitting || item.quantity <= 0.001} onClick={() => onQuantity(item.product_id, item.quantity - 1)} aria-label={`Decrease ${item.product_name} quantity`}>
                      <Minus size={15} aria-hidden="true" />
                    </button>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.001"
                      max={Number(item.stock_quantity)}
                      step="0.001"
                      value={item.quantity}
                      disabled={submitting}
                      onChange={(event) => onQuantity(item.product_id, event.target.value)}
                      aria-label={`${item.product_name} quantity`}
                    />
                    <button type="button" disabled={submitting || atStockLimit} onClick={() => onQuantity(item.product_id, item.quantity + 1)} aria-label={`Increase ${item.product_name} quantity`}>
                      <Plus size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="basket-item-subtotal">
                    <span>Subtotal</span>
                    <strong>{peso.format(Number(item.selling_price) * item.quantity)}</strong>
                  </div>
                </div>
                {atStockLimit && <p className="stock-limit-note">Maximum available stock selected.</p>}
              </div>
            )
          })}
        </div>
      )}

      <div className="basket-section">
        <h3>Customer and payment</h3>
        <div className="terms-row payment-methods" aria-label="Payment method">
          <button className={paymentType === 'Cash' ? 'selected' : ''} type="button" aria-pressed={paymentType === 'Cash'} disabled={submitting} onClick={() => { setPaymentType('Cash'); setError('') }}>
            Cash Sale
          </button>
          <button className={paymentType === 'Credit' ? 'selected' : ''} type="button" aria-pressed={paymentType === 'Credit'} disabled={submitting} onClick={() => { setPaymentType('Credit'); setError('') }}>Credit Sale</button>
        </div>
        <label>
          Customer
          <CustomerSelector customers={customers} paymentType={paymentType} value={customerId} onChange={(event) => { onCustomerChange(event.target.value); setError('') }} disabled={submitting} />
        </label>
        <button className="secondary-action add-customer-button" type="button" onClick={onAddCustomer} disabled={submitting}>
          Add Customer
        </button>
        <label>
          {paymentType === 'Cash' ? 'Cash received (exact amount)' : 'Amount paid'}
          <input type="number" inputMode="decimal" min="0" max={total || undefined} step="0.01" placeholder="0.00" value={amountPaid} disabled={submitting} onChange={(event) => { setAmountPaid(event.target.value); setError('') }} />
        </label>
      </div>

      <div className="sale-summary" aria-label="Sales summary">
        <h3>Sales summary</h3>
        <div><span>Total selected items</span><strong>{totalQuantity}</strong></div>
        <div><span>Subtotal</span><strong>{peso.format(total)}</strong></div>
        <div><span>Amount paid</span><strong>{peso.format(Number.isFinite(numericAmountPaid) ? numericAmountPaid : 0)}</strong></div>
        {paymentType === 'Credit' && <div><span>Remaining balance</span><strong>{peso.format(previewRemaining)}</strong></div>}
        <div className="sale-summary-total"><span>Final transaction total</span><strong>{peso.format(total)}</strong></div>
      </div>
      {error && !confirmationOpen && <p className="sales-feedback error" role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={reviewSale} disabled={!cart.length || submitting || amountPaid === '' || (paymentType === 'Credit' && !customerId)}>
        Review Sale
      </button>

      {confirmationOpen && (
        <SaleConfirmationModal
          cart={cart}
          customer={selectedCustomer}
          paymentType={paymentType}
          total={total}
          amountPaid={numericAmountPaid}
          submitting={submitting}
          error={error}
          onCancel={() => { if (!submitting) { setConfirmationOpen(false); setError('') } }}
          onConfirm={confirmSale}
        />
      )}
      {successResult && <TransactionSuccessModal type="sale" details={successDetails} onDone={finishSale} />}
    </aside>
  )
}

export default SalesBasket
