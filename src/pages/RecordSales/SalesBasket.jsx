import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  CreditCard,
  ShoppingCart,
  Trash2,
  UserPlus,
} from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import FormattedNumberInput from '../Shared/FormattedNumberInput.jsx'
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
import { useToast } from '../../context/ToastContext.jsx'
import { formatQuantityInput } from './quantityInput.js'

const maximumTransactionCents = 999999999999n

function SalesBasket({
  userId,
  cart,
  customers,
  customerId,
  onAddCustomer,
  onCustomerChange,
  onEditQuantity,
  onRemove,
  onClearCart,
  onProcess,
  onComplete,
  pendingSale,
  onPendingSaleChange,
  onCheckRecovery,
  recoveryMessage,
  recoveryError,
}) {
  const { showSuccess, showError } = useToast()
  const [amountPaid, setAmountPaid] = useState(() => pendingSale
    ? String(pendingSale.display?.amount_received ?? pendingSale.payload.amount_paid)
    : '')
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
  const cashChangeCents = amountPaidCents !== null && amountPaidCents > totalCents
    ? amountPaidCents - totalCents
    : 0n

  const isExactCash = paymentType === 'Cash' && totalCents > 0n && amountPaidCents === totalCents

  function handleSetExactCash() {
    if (totalCents > 0n && !submitting && !lockPending) {
      setAmountPaid(transactionCentsToAmount(totalCents))
      setError('')
    }
  }

  function reviewSale() {
    setError('')
    if (recoveryError) {
      setError('Saved sale recovery data must be resolved before another sale can be started.')
      showError('Saved sale recovery data must be resolved before another sale can be started.')
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
      showError('Sale total cannot exceed ₱9,999,999,999.99.')
      return
    }
    if (amountPaid.trim() === '' || !Number.isFinite(numericAmountPaid) || numericAmountPaid < 0 || amountPaidCents === null) {
      setError('Enter a valid amount paid with no more than two decimal places.')
      showError('Enter a valid amount paid with no more than two decimal places.')
      return
    }
    if (amountPaidCents > maximumTransactionCents) {
      setError('Amount cannot exceed ₱9,999,999,999.99.')
      showError('Amount cannot exceed ₱9,999,999,999.99.')
      return
    }
    if (paymentType === 'Credit' && amountPaidCents > totalCents) {
      setError('Amount paid cannot exceed the sale total.')
      showError('Amount paid cannot exceed the sale total.')
      return
    }
    if (paymentType === 'Cash' && amountPaidCents < totalCents) {
      setError('Cash received must cover the full sale total.')
      showError('Cash received must cover the full sale total.')
      return
    }
    if (paymentType === 'Credit' && !selectedCustomer) {
      setError('Select a customer for this credit sale.')
      showError('Select a customer for this credit sale.')
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
            amount_paid: paymentType === 'Cash' ? transactionCentsToAmount(totalCents) : amountPaid,
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
            amount_received: paymentType === 'Cash' ? amountPaid : null,
          },
        }
      }
      savePendingTransaction('sale', userId, attempt)
      onPendingSaleChange(attempt)
      const result = await onProcess(attempt.payload, attempt.key)
      const completedAttempt = { ...attempt, state: 'completed', response: result }
      savePendingTransaction('sale', userId, completedAttempt)
      onPendingSaleChange(completedAttempt)
      showSuccess('Sale recorded successfully.')
      setConfirmationOpen(false)
    } catch (requestError) {
      showError(requestError.message || 'Unable to record sale')
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
    ...(successResult.paymentType === 'Cash'
      ? [
        { label: 'Amount received', value: formatTransactionCents(amountPaidCents ?? 0n, peso) },
        { label: 'Change returned', value: formatTransactionCents(cashChangeCents, peso) },
      ]
      : []),
    ...(Number(successResult.remaining_balance) > 0
      ? [{ label: 'Remaining balance', value: peso.format(Number(successResult.remaining_balance)) }]
      : []),
  ] : []

  return (
    <aside className="panel basket-panel" aria-busy={submitting}>
      {/* Basket Header */}
      <div className="basket-heading">
        <div className="basket-title-wrap">
          <span className="basket-icon-badge">
            <ShoppingCart size={17} aria-hidden="true" />
          </span>
          <div>
            <span className="basket-subtitle">TRANSACTION CART</span>
            <h2>Current Sale</h2>
          </div>
        </div>

        <div className="basket-heading-actions">
          <span className="basket-count-pill">
            {cart.length} {cart.length === 1 ? 'item' : 'items'}
          </span>
          {cart.length > 0 && !lockPending && onClearCart && (
            <button
              type="button"
              className="basket-clear-btn"
              onClick={onClearCart}
              disabled={submitting || lockPending}
              title="Clear all items in cart"
            >
              <Trash2 size={12} aria-hidden="true" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Recovery Notice */}
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

      {/* Cart Items List */}
      <div className="basket-items" aria-label="Selected products">
        {!cart.length && (
          <EmptyState>
            No items in cart. Click any available product from the catalog to start a sale.
          </EmptyState>
        )}
        {cart.map((item) => {
          const atStockLimit = item.quantity >= Number(item.stock_quantity)
          const lineCents = transactionLineCents(item.quantity, item.selling_price)
          return (
            <div className="basket-item" key={item.product_id}>
              <button
                className="basket-item-edit"
                type="button"
                disabled={submitting || lockPending}
                onClick={() => onEditQuantity(item)}
                aria-label={`Edit ${item.product_name} quantity`}
              >
                <div className="basket-item-heading">
                  <div className="basket-item-meta">
                    <strong className="basket-item-name">{item.product_name}</strong>
                    <span className="basket-item-rate">
                      {peso.format(Number(item.selling_price))} / {item.unit || 'kg'}
                    </span>
                  </div>
                </div>
                <div className="basket-item-controls">
                  <div className="basket-item-quantity">
                    <span>Quantity</span>
                    <strong>{formatQuantityInput(item.quantity)} {item.unit || 'kg'}</strong>
                  </div>
                  <div className="basket-item-subtotal">
                    <span>Subtotal</span>
                    <strong>{formatTransactionCents(lineCents, peso)}</strong>
                  </div>
                </div>
              </button>

              <button
                className="basket-remove-button"
                type="button"
                disabled={submitting || lockPending}
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove(item.product_id)
                }}
                aria-label={`Remove ${item.product_name}`}
                title={`Remove ${item.product_name}`}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>

              {atStockLimit && (
                <div className="stock-limit-note">
                  <AlertCircle size={12} aria-hidden="true" />
                  <span>Max stock reached ({Number(item.stock_quantity)} {item.unit || 'kg'})</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Customer, Payment, & Summary Section */}
      <div className="basket-checkout">
        <div className="basket-section">
          <h3>Customer & Payment</h3>

          {/* Payment Method Switch */}
          <div className="terms-row payment-methods" aria-label="Payment method">
            <button
              className={`payment-toggle-btn ${paymentType === 'Cash' ? 'selected' : ''}`}
              type="button"
              aria-pressed={paymentType === 'Cash'}
              disabled={submitting || lockPending}
              onClick={() => { setPaymentType('Cash'); setError('') }}
            >
              <Banknote size={15} aria-hidden="true" />
              <span>Cash Sale</span>
            </button>
            <button
              className={`payment-toggle-btn ${paymentType === 'Credit' ? 'selected' : ''}`}
              type="button"
              aria-pressed={paymentType === 'Credit'}
              disabled={submitting || lockPending}
              onClick={() => { setPaymentType('Credit'); setError('') }}
            >
              <CreditCard size={15} aria-hidden="true" />
              <span>Credit Sale</span>
            </button>
          </div>

          {/* Customer Selection */}
          <div className="pos-customer-row">
            <label className="pos-field-label">
              <span>Customer</span>
              <CustomerSelector
                customers={customers}
                paymentType={paymentType}
                value={customerId}
                onChange={(event) => { onCustomerChange(event.target.value); setError('') }}
                disabled={submitting || lockPending}
              />
            </label>
            <button
              className="secondary-action add-customer-button"
              type="button"
              onClick={onAddCustomer}
              disabled={submitting || lockPending}
              title="Add a new customer"
            >
              <UserPlus size={14} aria-hidden="true" />
              <span>New</span>
            </button>
          </div>

          {/* Credit Customer Balance Badge */}
          {paymentType === 'Credit' && selectedCustomer && (
            <div className="pos-customer-credit-info">
              <span className="customer-credit-label">Current Outstanding Balance:</span>
              <strong className="customer-credit-amount">
                {peso.format(Number(selectedCustomer.current_balance || 0))}
              </strong>
            </div>
          )}

          {/* Amount Paid Input & Quick Cash Preset */}
          <div className="pos-amount-field-wrap">
            <label className="pos-field-label">
              <span>{paymentType === 'Cash' ? 'Cash Received' : 'Amount Paid (Deposit)'}</span>
              <div className="pos-input-currency-wrap">
                <span className="currency-prefix" aria-hidden="true">₱</span>
                <FormattedNumberInput
                  placeholder="0.00"
                  value={amountPaid}
                  disabled={submitting || lockPending}
                  onValueChange={(value) => { setAmountPaid(value); setError('') }}
                />
              </div>
            </label>

            {/* Quick Cash Button */}
            {paymentType === 'Cash' && totalCents > 0n && (
              <div className="pos-quick-cash-row">
                <button
                  type="button"
                  className={`quick-cash-btn ${isExactCash ? 'is-exact' : ''}`}
                  onClick={handleSetExactCash}
                  disabled={submitting || lockPending}
                  title="Click to automatically tender exact cash amount"
                >
                  {isExactCash ? (
                    <>
                      <CheckCircle2 size={13} aria-hidden="true" />
                      <span>Exact Cash Tendered ({formatTransactionCents(totalCents, peso)})</span>
                    </>
                  ) : (
                    <span>Exact Total: {formatTransactionCents(totalCents, peso)}</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Order Summary */}
        <div className="sale-summary" aria-label="Sales summary">
          <h3>Sales Summary</h3>
          <div>
            <span>Total Items</span>
            <strong>{cart.length} {cart.length === 1 ? 'item' : 'items'} ({totalQuantity.toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg)</strong>
          </div>
          <div>
            <span>Subtotal</span>
            <strong>{formatTransactionCents(totalCents, peso)}</strong>
          </div>
          <div>
            <span>{paymentType === 'Cash' ? 'Amount Received' : 'Amount Paid'}</span>
            <strong>{formatTransactionCents(amountPaidCents ?? 0n, peso)}</strong>
          </div>
          {paymentType === 'Cash' && (
            <div className="sale-summary-balance">
              <span>Change</span>
              <strong>{formatTransactionCents(cashChangeCents, peso)}</strong>
            </div>
          )}
          {paymentType === 'Credit' && (
            <div className="sale-summary-balance">
              <span>Remaining Balance</span>
              <strong>{formatTransactionCents(previewRemainingCents, peso)}</strong>
            </div>
          )}
          <div className="sale-summary-total">
            <span>Total Amount Due</span>
            <strong>{formatTransactionCents(totalCents, peso)}</strong>
          </div>
        </div>

        {error && !confirmationOpen && <p className="sales-feedback error" role="alert">{error}</p>}
      </div>

      {/* Review / Submit Action */}
      <button
        className="primary-action pos-submit-btn"
        type="button"
        onClick={reviewSale}
        disabled={
          !cart.length ||
          submitting ||
          amountPaid === '' ||
          recoveryError ||
          (paymentType === 'Credit' && !customerId) ||
          pendingSale?.state === 'rejected'
        }
      >
        {pendingSale?.state === 'pending' ? 'Retry Pending Sale' : 'Review & Confirm Sale'}
      </button>

      {confirmationOpen && (
        <SaleConfirmationModal
          cart={cart}
          customer={confirmationCustomer}
          paymentType={paymentType}
          totalCents={totalCents}
          amountPaidCents={amountPaidCents ?? 0n}
          changeCents={cashChangeCents}
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
