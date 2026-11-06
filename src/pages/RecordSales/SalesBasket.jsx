import { useMemo, useRef, useState } from 'react'
import { Minus, Plus, Trash2 } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import CustomerSelector from './CustomerSelector.jsx'
import SaleConfirmationModal from './SaleConfirmationModal.jsx'
import { peso } from '../../utils/currency.js'
import { createIdempotencyKey } from '../../utils/idempotency.js'
import {
  clearPendingTransaction,
  savePendingTransaction,
} from '../../utils/pendingTransaction.js'
import {
  formatTransactionCents,
  toTransactionCents,
  transactionLineCents,
  transactionCentsToAmount,
  transactionTotalCents,
} from '../../utils/transactionMoney.js'

const maximumTransactionCents = 999999999999n

function SalesBasket({
  userId,
  cart,
  customers,
  customerId,
  onAddCustomer,
  onCustomerChange,
  onQuantity,
  onRemove,
  onProcess,
  onComplete,
  pendingSale,
  onPendingSaleChange,
  onCheckRecovery,
  recoveryMessage,
  recoveryError,
}) {
  const [amountPaid, setAmountPaid] = useState(() => pendingSale ? String(pendingSale.payload.amount_paid) : '')
  const [paymentType, setPaymentType] = useState(() => pendingSale?.payload.payment_type || 'Cash')
  const [confirmationOpen, setConfirmationOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [confirmEditRejected, setConfirmEditRejected] = useState(false)
  const submissionLock = useRef(false)
  const totalCents = useMemo(() => transactionTotalCents(cart), [cart])
  const totalQuantity = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart])
  const selectedCustomer = customers.find((customer) => String(customer.customer_id) === String(customerId))
  const successResult = pendingSale?.state === 'completed' && pendingSale.response
    ? {
      ...pendingSale.response,
      customerName: selectedCustomer?.customer_name
        || pendingSale.display?.customer_name
        || 'Walk-In Customer',
      paymentType: pendingSale.payload.payment_type,
    }
    : null
  const confirmationCustomer = selectedCustomer || (
    pendingSale?.payload.customer_id
      ? { customer_name: pendingSale.display?.customer_name || `Saved customer ${pendingSale.payload.customer_id}` }
      : null
  )
  const numericAmountPaid = Number(amountPaid)
  const lockPending = Boolean(pendingSale || recoveryError)
  let amountPaidCents
  try {
    amountPaidCents = toTransactionCents(amountPaid || '0')
  } catch {
    amountPaidCents = null
  }
  const previewRemainingCents = amountPaidCents !== null && amountPaidCents <= totalCents
    ? totalCents - amountPaidCents
    : totalCents

  function reviewSale() {
    setError('')
    if (recoveryError) {
      setError('Saved sale recovery data must be resolved before another sale can be started.')
      return
    }
    if (pendingSale) {
      if (pendingSale.state === 'rejected') return
      setConfirmationOpen(true)
      return
    }
    if (!cart.length) return
    if (totalCents > maximumTransactionCents) {
      setError('Sale total cannot exceed ₱9,999,999,999.99.')
      return
    }
    if (amountPaid.trim() === '' || !Number.isFinite(numericAmountPaid) || numericAmountPaid < 0 || amountPaidCents === null) {
      setError('Enter a valid amount paid with no more than two decimal places.')
      return
    }
    if (amountPaidCents > totalCents) {
      setError('Amount paid cannot exceed the sale total.')
      return
    }
    if (paymentType === 'Cash' && amountPaidCents !== totalCents) {
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

    let attempt = pendingSale
    try {
      if (attempt?.state === 'rejected') return
      if (!attempt) {
        attempt = {
          key: createIdempotencyKey(),
          state: 'pending',
          payload: {
            customer_id: customerId ? Number(customerId) : null,
            payment_type: paymentType,
            amount_paid: amountPaid,
            items: cart.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          },
          display: {
            cart: cart.map((item) => ({
              product_id: item.product_id,
              product_name: item.product_name,
              category: item.category,
              unit: item.unit,
              selling_price: item.selling_price,
              stock_quantity: item.stock_quantity,
              quantity: item.quantity,
            })),
            customer_id: customerId || null,
            customer_name: selectedCustomer?.customer_name || null,
          },
        }
      }
      savePendingTransaction('sale', userId, attempt)
      onPendingSaleChange(attempt)
      const result = await onProcess(attempt.payload, attempt.key)
      const completedAttempt = { ...attempt, state: 'completed', response: result }
      savePendingTransaction('sale', userId, completedAttempt)
      onPendingSaleChange(completedAttempt)
      setConfirmationOpen(false)
    } catch (requestError) {
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
          savePendingTransaction('sale', userId, rejectedAttempt)
          onPendingSaleChange(rejectedAttempt)
          setError('This sale was rejected and confirmed not committed. Edit or discard it before starting another sale.')
        } catch (storageError) {
          setError(`${requestError.message}. ${storageError.message}`)
        }
      }
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  function finishSale() {
    try {
      clearPendingTransaction('sale', userId)
    } catch (storageError) {
      setError(storageError.message)
      return
    }

    onPendingSaleChange(null)
    setAmountPaid('')
    setPaymentType('Cash')
    onCustomerChange('')
    setError('')
    onComplete()
  }

  function editRejectedSale() {
    try {
      clearPendingTransaction('sale', userId)
    } catch (storageError) {
      setError(storageError.message)
      return
    }
    onPendingSaleChange(null)
    setConfirmEditRejected(false)
    setConfirmationOpen(false)
    setError('')
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

      {pendingSale?.state === 'pending' && (
        <div className="sales-feedback" role="status">
          <p>A sale submission is unresolved. The original items and payment are locked to prevent a duplicate or changed retry.</p>
          <p>{recoveryMessage || 'Retry the original sale to safely recover its result.'}</p>
          <button className="secondary-action" type="button" onClick={onCheckRecovery} disabled={submitting}>
            Check transaction status
          </button>
        </div>
      )}
      {pendingSale?.state === 'rejected' && (
        <div className="sales-feedback error" role="status">
          <p>This sale was rejected and confirmed not committed. Its original details remain saved until you choose to edit it.</p>
          {!confirmEditRejected ? (
            <button className="secondary-action" type="button" onClick={() => setConfirmEditRejected(true)} disabled={submitting}>
              Edit Rejected Sale
            </button>
          ) : (
            <div className="confirmation-actions">
              <span>Clear this rejected attempt? The next submission will use a new key.</span>
              <button className="secondary-action" type="button" onClick={editRejectedSale}>Confirm Edit</button>
              <button className="secondary-action" type="button" onClick={() => setConfirmEditRejected(false)}>Keep Attempt</button>
            </div>
          )}
        </div>
      )}

      <div className="basket-items" aria-label="Selected products">
        {!cart.length && <EmptyState>Select an available product to start a sale.</EmptyState>}
        {cart.map((item) => {
            const atStockLimit = item.quantity >= Number(item.stock_quantity)
            const lineCents = transactionLineCents(item.quantity, item.selling_price)
            return (
              <div className="basket-item" key={item.product_id}>
                <div className="basket-item-heading">
                  <div>
                    <strong>{item.product_name}</strong>
                    <span>{peso.format(Number(item.selling_price))} per {item.unit}</span>
                  </div>
                  <button className="basket-remove-button" type="button" disabled={submitting || lockPending} onClick={() => onRemove(item.product_id)} aria-label={`Remove ${item.product_name}`}>
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="basket-item-controls">
                  <div className="quantity-stepper">
                    <button type="button" disabled={submitting || lockPending || item.quantity <= 0.001} onClick={() => onQuantity(item.product_id, item.quantity - 1)} aria-label={`Decrease ${item.product_name} quantity`}>
                      <Minus size={15} aria-hidden="true" />
                    </button>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.001"
                      max={Number(item.stock_quantity)}
                      step="0.001"
                      value={item.quantity}
                      disabled={submitting || lockPending}
                      onChange={(event) => onQuantity(item.product_id, event.target.value)}
                      aria-label={`${item.product_name} quantity`}
                    />
                    <button type="button" disabled={submitting || lockPending || atStockLimit} onClick={() => onQuantity(item.product_id, item.quantity + 1)} aria-label={`Increase ${item.product_name} quantity`}>
                      <Plus size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="basket-item-subtotal">
                    <span>Subtotal</span>
                    <strong>{formatTransactionCents(lineCents, peso)}</strong>
                  </div>
                </div>
                {atStockLimit && <p className="stock-limit-note">Maximum available stock selected.</p>}
              </div>
            )
          })}
      </div>

      <div className="basket-checkout">
        <div className="basket-section">
          <h3>Customer and payment</h3>
          <div className="terms-row payment-methods" aria-label="Payment method">
            <button className={paymentType === 'Cash' ? 'selected' : ''} type="button" aria-pressed={paymentType === 'Cash'} disabled={submitting || lockPending} onClick={() => { setPaymentType('Cash'); setError('') }}>
              Cash Sale
            </button>
            <button className={paymentType === 'Credit' ? 'selected' : ''} type="button" aria-pressed={paymentType === 'Credit'} disabled={submitting || lockPending} onClick={() => { setPaymentType('Credit'); setError('') }}>Credit Sale</button>
          </div>
          <label>
            Customer
            <CustomerSelector customers={customers} paymentType={paymentType} value={customerId} onChange={(event) => { onCustomerChange(event.target.value); setError('') }} disabled={submitting || lockPending} />
          </label>
          <button className="secondary-action add-customer-button" type="button" onClick={onAddCustomer} disabled={submitting || lockPending}>
            Add Customer
          </button>
          <label>
            {paymentType === 'Cash' ? 'Cash received (exact amount)' : 'Amount paid'}
            <input type="number" inputMode="decimal" min="0" max={Number(transactionCentsToAmount(totalCents)) || undefined} step="0.01" placeholder="0.00" value={amountPaid} disabled={submitting || lockPending} onChange={(event) => { setAmountPaid(event.target.value); setError('') }} />
          </label>
        </div>

        <div className="sale-summary" aria-label="Sales summary">
          <h3>Sales summary</h3>
          <div><span>Total selected items</span><strong>{totalQuantity}</strong></div>
          <div><span>Subtotal</span><strong>{formatTransactionCents(totalCents, peso)}</strong></div>
          <div><span>Amount paid</span><strong>{peso.format(Number.isFinite(numericAmountPaid) ? numericAmountPaid : 0)}</strong></div>
          {paymentType === 'Credit' && <div className="sale-summary-balance"><span>Remaining balance</span><strong>{formatTransactionCents(previewRemainingCents, peso)}</strong></div>}
          <div className="sale-summary-total"><span>Final transaction total</span><strong>{formatTransactionCents(totalCents, peso)}</strong></div>
        </div>
        {error && !confirmationOpen && <p className="sales-feedback error" role="alert">{error}</p>}
      </div>
      <button className="primary-action" type="button" onClick={reviewSale} disabled={!cart.length || submitting || amountPaid === '' || recoveryError || (paymentType === 'Credit' && !customerId) || pendingSale?.state === 'rejected'}>
        {pendingSale?.state === 'pending' ? 'Retry Pending Sale' : 'Review Sale'}
      </button>

      {confirmationOpen && (
        <SaleConfirmationModal
          cart={cart}
          customer={confirmationCustomer}
          paymentType={paymentType}
          totalCents={totalCents}
          amountPaidCents={amountPaidCents ?? 0n}
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
