import { useMemo, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import CustomerSelector from './CustomerSelector.jsx'
import { peso } from '../../utils/currency.js'

function SalesBasket({ cart, customers, onAddCustomer, onQuantity, onRemove, onProcess }) {
  const [amountPaid, setAmountPaid] = useState('')
  const [paymentType, setPaymentType] = useState('Cash')
  const [customerId, setCustomerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const total = useMemo(() => cart.reduce(
    (sum, item) => sum + Number(item.selling_price) * item.quantity,
    0,
  ), [cart])

  async function handleProcess() {
    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const result = await onProcess({ amountPaid: Number(amountPaid), paymentType, customerId })
      setAmountPaid('')
      setSuccess(`Sale ${result.sale_id} recorded successfully`)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <aside className="panel basket-panel" aria-busy={submitting}>
      <h2>ACTIVE SALES BASKET</h2>
      <label>
        Customer
        <CustomerSelector customers={customers} paymentType={paymentType} value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={submitting} />
      </label>
      <button className="secondary-action" type="button" onClick={onAddCustomer} disabled={submitting}>
        Add Customer
      </button>
      {!cart.length && <EmptyState>Select products to add to the sale.</EmptyState>}
      {cart.map((item) => (
        <div className="bill-total basket-item" key={item.product_id}>
          <div className="basket-item-details">
            <strong>{item.product_name}</strong>
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
          </div>
          <button className="table-action danger" type="button" disabled={submitting} onClick={() => onRemove(item.product_id)}>Remove</button>
        </div>
      ))}
      <div className="terms-row">
        <button className={paymentType === 'Cash' ? 'selected' : ''} type="button" aria-pressed={paymentType === 'Cash'} disabled={submitting} onClick={() => { setPaymentType('Cash'); setCustomerId('') }}>
          Cash Sale
        </button>
        <button className={paymentType === 'Credit' ? 'selected' : ''} type="button" aria-pressed={paymentType === 'Credit'} disabled={submitting} onClick={() => setPaymentType('Credit')}>Credit Sale</button>
      </div>
      <label>
        Amount paid
        <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" value={amountPaid} disabled={submitting} onChange={(event) => setAmountPaid(event.target.value)} />
      </label>
      <div className="bill-total">
        <span>Total bill</span>
        <strong>{peso.format(total)}</strong>
      </div>
      {error && <p className="sales-feedback error" role="alert">{error}</p>}
      {success && <p className="sales-feedback success" role="status">{success}</p>}
      <button className="primary-action" type="button" onClick={handleProcess} disabled={!cart.length || submitting || amountPaid === '' || (paymentType === 'Credit' && !customerId)}>
        {submitting && <span className="sales-submit-spinner" aria-hidden="true" />}
        {submitting ? 'Recording Sale...' : 'Record Sale'}
      </button>
    </aside>
  )
}

export default SalesBasket
