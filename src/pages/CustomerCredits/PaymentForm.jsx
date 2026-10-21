import { useRef, useState } from 'react'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import PaymentConfirmationModal from './PaymentConfirmationModal.jsx'
import { recordPayment } from '../../services/paymentService.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

function PaymentForm({ customer, credits, onRecorded }) {
  const openCredits = credits.filter((credit) => Number(credit.remaining_balance) > 0)
  const [saleId, setSaleId] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [error, setError] = useState('')
  const [refreshWarning, setRefreshWarning] = useState('')
  const [successResult, setSuccessResult] = useState(null)
  const submissionLock = useRef(false)
  const selectedCredit = openCredits.find((credit) => String(credit.sale_id) === String(saleId))

  function validatePayment() {
    const numericAmount = Number(amount)
    if (!selectedCredit || amount.trim() === '' || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return 'Select an unpaid credit sale and enter a valid payment amount.'
    }
    if (Math.round(numericAmount * 100) > Math.round(Number(selectedCredit.remaining_balance) * 100)) {
      return 'Payment cannot exceed the outstanding balance.'
    }
    return ''
  }

  function handleReview() {
    const validationError = validatePayment()
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    setReviewOpen(true)
  }

  async function handlePayment() {
    if (submissionLock.current) return
    const validationError = validatePayment()
    if (validationError) {
      setError(validationError)
      return
    }

    submissionLock.current = true
    setSubmitting(true)
    setError('')
    setRefreshWarning('')
    try {
      const result = await recordPayment({ sale_id: saleId, payment_amount: amount })
      let recordedPayment
      try {
        recordedPayment = await onRecorded(result.payment_id)
      } catch (refreshError) {
        setRefreshWarning(`Payment recorded, but the ledger could not be refreshed: ${refreshError.message}`)
      }
      setSuccessResult({ ...result, payment_date: recordedPayment?.payment_date })
      setReviewOpen(false)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  function finishPayment() {
    setSuccessResult(null)
    setAmount('')
    setSaleId('')
    setRefreshWarning('')
    setError('')
  }

  const successDetails = successResult ? [
    { label: 'Customer name', value: customer.customer_name },
    { label: 'Payment reference', value: `PAY-${successResult.payment_id}` },
    { label: 'Amount paid', value: peso.format(Number(successResult.payment_amount)) },
    { label: 'Remaining balance', value: peso.format(Number(successResult.remaining_balance)) },
    ...(successResult.payment_date
      ? [{ label: 'Payment date/time', value: formatActivityTimestamp(successResult.payment_date).dateTime }]
      : []),
  ] : []

  return (
    <div className="payment-form" aria-busy={submitting}>
      <div className="payment-form-heading">
        <h3>Record Customer Payment</h3>
        <p>Apply a payment to one of {customer.customer_name}&apos;s unpaid credit sales.</p>
      </div>
      <label>
        <span>Credit Sale <b className="required-marker" aria-hidden="true">*</b></span>
        <select value={saleId} onChange={(event) => { setSaleId(event.target.value); setError('') }} disabled={submitting || !openCredits.length}>
          <option value="">Select unpaid credit sale</option>
          {openCredits.map((credit) => <option key={credit.sale_id} value={credit.sale_id}>OR-{credit.sale_id} - {peso.format(Number(credit.remaining_balance))}</option>)}
        </select>
      </label>
      <label>
        <span>Payment Amount <b className="required-marker" aria-hidden="true">*</b></span>
        <input type="number" inputMode="decimal" min="0.01" max={selectedCredit ? Number(selectedCredit.remaining_balance) : undefined} step="0.01" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setError('') }} disabled={submitting || !openCredits.length} />
      </label>
      {selectedCredit && (
        <div className="payment-balance-preview">
          <span>Selected sale outstanding balance</span>
          <strong>{peso.format(Number(selectedCredit.remaining_balance))}</strong>
        </div>
      )}
      {!openCredits.length && <p className="payment-settled-note">This customer has no unpaid credit sales.</p>}
      {error && !reviewOpen && <p className="payment-feedback error" role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={handleReview} disabled={submitting || !openCredits.length}>
        Review Payment
      </button>
      {reviewOpen && selectedCredit && (
        <PaymentConfirmationModal
          customer={customer}
          credit={selectedCredit}
          amount={amount}
          submitting={submitting}
          error={error}
          onCancel={() => { if (!submitting) { setReviewOpen(false); setError('') } }}
          onConfirm={handlePayment}
        />
      )}
      {successResult && (
        <TransactionSuccessModal type="payment" details={successDetails} notice={refreshWarning} onDone={finishPayment} />
      )}
    </div>
  )
}

export default PaymentForm
