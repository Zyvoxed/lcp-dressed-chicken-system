import { useState } from 'react'
import { recordPayment } from '../../services/paymentService.js'
import { peso } from '../../utils/currency.js'

function PaymentForm({ credits, onRecorded }) {
  const openCredits = credits.filter((credit) => Number(credit.remaining_balance) > 0)
  const [saleId, setSaleId] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handlePayment() {
    setSubmitting(true)
    setError('')
    try {
      await recordPayment({ sale_id: saleId, payment_amount: amount })
      setAmount('')
      setSaleId('')
      await onRecorded()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="payment-form" aria-busy={submitting}>
      <label>
        Credit sale
        <select value={saleId} onChange={(event) => setSaleId(event.target.value)} disabled={submitting}>
          <option value="">Select unpaid credit sale</option>
          {openCredits.map((credit) => <option key={credit.sale_id} value={credit.sale_id}>OR-{credit.sale_id} — {peso.format(Number(credit.remaining_balance))}</option>)}
        </select>
      </label>
      <label>
        Payment Amount
        <input type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={submitting} />
      </label>
      {error && <p className="payment-feedback error" role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={handlePayment} disabled={!saleId || !amount || submitting}>
        {submitting && <span className="payment-submit-spinner" aria-hidden="true" />}
        {submitting ? 'Recording Payment...' : 'Record Payment'}
      </button>
    </div>
  )
}

export default PaymentForm
