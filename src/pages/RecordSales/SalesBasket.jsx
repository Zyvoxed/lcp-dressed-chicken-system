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
    <aside className="panel basket-panel">
      <h2>ACTIVE SALES BASKET</h2>
      <CustomerSelector customers={customers} paymentType={paymentType} value={customerId} onChange={(event) => setCustomerId(event.target.value)} />
      <button className="secondary-action" type="button" onClick={onAddCustomer}>
        Quick Register
      </button>
      {!cart.length && <EmptyState>Basket is ready for selected products</EmptyState>}
      {cart.map((item) => (
        <div className="bill-total" key={item.product_id}>
          <div>
            <strong>{item.product_name}</strong>
            <input
              type="number"
              min="0.001"
              max={Number(item.stock_quantity)}
              step="0.001"
              value={item.quantity}
              onChange={(event) => onQuantity(item.product_id, event.target.value)}
              aria-label={`${item.product_name} quantity`}
            />
          </div>
          <button className="table-action danger" type="button" onClick={() => onRemove(item.product_id)}>Remove</button>
        </div>
      ))}
      <div className="terms-row">
        <button className={paymentType === 'Cash' ? 'selected' : ''} type="button" onClick={() => { setPaymentType('Cash'); setCustomerId('') }}>
          Cash Sale
        </button>
        <button className={paymentType === 'Credit' ? 'selected' : ''} type="button" onClick={() => setPaymentType('Credit')}>Credit Term</button>
      </div>
      <label>
        Amount paid
        <input type="number" min="0" step="0.01" placeholder="0.00" value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} />
      </label>
      <div className="bill-total">
        <span>Total bill</span>
        <strong>{peso.format(total)}</strong>
      </div>
      {error && <p role="alert">{error}</p>}
      {success && <p className="status active">{success}</p>}
      <button className="primary-action" type="button" onClick={handleProcess} disabled={!cart.length || submitting || amountPaid === '' || (paymentType === 'Credit' && !customerId)}>
        {submitting ? 'Processing Order' : 'Process Order'}
      </button>
    </aside>
  )
}

export default SalesBasket
