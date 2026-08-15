import { useState } from 'react'
import { recordPayment } from '../../services/paymentService.js'

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
    <>
      <label>
        Credit sale
        <select value={saleId} onChange={(event) => setSaleId(event.target.value)}>
          <option value="">Select outstanding sale</option>
          {openCredits.map((credit) => <option key={credit.sale_id} value={credit.sale_id}>OR-{credit.sale_id} — {credit.remaining_balance}</option>)}
        </select>
      </label>
      <label>
        Payment posting
        <input type="number" min="0.01" step="0.01" placeholder="Payment amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={handlePayment} disabled={!saleId || !amount || submitting}>
        {submitting ? 'Posting Payment' : 'Post Payment'}
      </button>
    </>
  )
}

export default PaymentForm
