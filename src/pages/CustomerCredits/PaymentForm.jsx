import { useEffect, useRef, useState } from 'react'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import PaymentConfirmationModal from './PaymentConfirmationModal.jsx'
import { recordPayment } from '../../services/paymentService.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import { createIdempotencyKey } from '../../utils/idempotency.js'
import { getIdempotencyStatus } from '../../services/idempotencyService.js'
import {
  clearPendingTransaction,
  readPendingTransaction,
  savePendingTransaction,
  validatePaymentResponse,
} from '../../utils/pendingTransaction.js'
import { toTransactionCents } from '../../utils/transactionMoney.js'
import { useAuth } from '../../hooks/useAuth.js'

function getInitialPaymentRecovery(userId) {
  try {
    return { attempt: readPendingTransaction('payment', userId), error: '' }
  } catch (error) {
    return { attempt: null, error: error.message }
  }
}

function PaymentForm({ customer, credits, onRecorded, onSelectCustomer }) {
  const { user } = useAuth()
  return (
    <PaymentFormForUser
      key={`${user?.user_id || 'unauthenticated'}-${customer.customer_id}`}
      userId={user?.user_id}
      customer={customer}
      credits={credits}
      onRecorded={onRecorded}
      onSelectCustomer={onSelectCustomer}
    />
  )
}

function PaymentFormForUser({ userId, customer, credits, onRecorded, onSelectCustomer }) {
  const openCredits = credits.filter((credit) => Number(credit.remaining_balance) > 0)
  const [initialRecovery] = useState(() => getInitialPaymentRecovery(userId))
  const [saleId, setSaleId] = useState(() => initialRecovery.attempt ? String(initialRecovery.attempt.payload.sale_id) : '')
  const [amount, setAmount] = useState(() => initialRecovery.attempt ? String(initialRecovery.attempt.payload.payment_amount) : '')
  const [submitting, setSubmitting] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [error, setError] = useState('')
  const [refreshWarning, setRefreshWarning] = useState('')
  const [successResult, setSuccessResult] = useState(null)
  const [confirmEditRejected, setConfirmEditRejected] = useState(false)
  const submissionLock = useRef(false)
  const [pendingAttempt, setPendingAttempt] = useState(initialRecovery.attempt)
  const [recoveryMessage, setRecoveryMessage] = useState(initialRecovery.error)
  const recoveryChecked = useRef(false)
  const pendingCustomerMatches = !pendingAttempt
    || Number(pendingAttempt.display?.customer_id) === Number(customer.customer_id)
  const recoveryBlocked = Boolean(recoveryMessage && !pendingAttempt) || !pendingCustomerMatches
  const selectedCredit = openCredits.find((credit) => String(credit.sale_id) === String(saleId))
    || pendingAttempt?.display?.credit

  useEffect(() => {
    if (!pendingAttempt || !pendingCustomerMatches || pendingAttempt.state === 'rejected' || recoveryChecked.current) return undefined
    recoveryChecked.current = true
    let active = true

    async function recoverPayment() {
      try {
        const status = await getIdempotencyStatus('payment', pendingAttempt.key)
        if (!active) return
        if (status.state === 'completed') {
          validatePaymentResponse(pendingAttempt, status.response?.data)
          let recordedPayment = null
          let warning = ''
          try {
            recordedPayment = await onRecorded(pendingAttempt.display.customer_id, status.response.data.payment_id)
          } catch (refreshError) {
            warning = `Payment was recorded, but the ledger could not be refreshed: ${refreshError.message}`
          }
          if (!active) return
          const response = {
            ...status.response.data,
            payment_date: recordedPayment?.payment_date,
          }
          const completedAttempt = {
            ...pendingAttempt,
            state: 'completed',
            response,
          }
          savePendingTransaction('payment', userId, completedAttempt)
          setPendingAttempt(completedAttempt)
          setSuccessResult(response)
          setRefreshWarning(warning)
          setRecoveryMessage('The payment was already recorded. Its original result is ready to review.')
        } else {
          setRecoveryMessage('No completed result was found. Retry the original payment to safely recover or finish it.')
        }
      } catch (statusError) {
        if (active) setRecoveryMessage(`${statusError.message}. Retry the original payment with its saved key.`)
      }
    }

    recoverPayment()
    return () => { active = false }
  }, [pendingAttempt, pendingCustomerMatches, onRecorded, userId])

  function validatePayment() {
    const numericAmount = Number(amount)
    if (!selectedCredit || amount.trim() === '' || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return 'Select an unpaid credit sale and enter a valid payment amount.'
    }
    let amountCents
    let balanceCents
    try {
      amountCents = toTransactionCents(amount)
      balanceCents = toTransactionCents(selectedCredit.remaining_balance)
    } catch {
      return 'Payment amount must have no more than two decimal places.'
    }
    if (amountCents > balanceCents) {
      return 'Payment cannot exceed the outstanding balance.'
    }
    return ''
  }

  function handleReview() {
    if (recoveryBlocked) return
    if (pendingAttempt) {
      if (pendingAttempt.state === 'rejected') return
      setError('')
      setReviewOpen(true)
      return
    }
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
    if (!pendingCustomerMatches || pendingAttempt?.state === 'rejected') return
    const validationError = pendingAttempt ? '' : validatePayment()
    if (validationError) {
      setError(validationError)
      return
    }

    submissionLock.current = true
    setSubmitting(true)
    setError('')
    setRefreshWarning('')
    let attempt = pendingAttempt
    try {
      if (!attempt) {
        attempt = {
          key: createIdempotencyKey(),
          state: 'pending',
          payload: { sale_id: Number(saleId), payment_amount: amount },
          display: {
            customer_id: Number(customer.customer_id),
            customer_name: customer.customer_name,
            credit: {
              sale_id: selectedCredit.sale_id,
              sale_date: selectedCredit.sale_date,
              total_amount: selectedCredit.total_amount,
              amount_paid: selectedCredit.amount_paid,
              remaining_balance: selectedCredit.remaining_balance,
              status: selectedCredit.status,
            },
          },
        }
      }
      savePendingTransaction('payment', userId, attempt)
      recoveryChecked.current = true
      setPendingAttempt(attempt)
      const result = await recordPayment(attempt.payload, attempt.key)
      validatePaymentResponse(attempt, result)
      let recordedPayment
      try {
        recordedPayment = await onRecorded(attempt.display.customer_id, result.payment_id)
      } catch (refreshError) {
        setRefreshWarning(`Payment recorded, but the ledger could not be refreshed: ${refreshError.message}`)
      }
      const completedResult = { ...result, payment_date: recordedPayment?.payment_date }
      const completedAttempt = { ...attempt, state: 'completed', response: completedResult }
      savePendingTransaction('payment', userId, completedAttempt)
      setPendingAttempt(completedAttempt)
      setSuccessResult(completedResult)
      setReviewOpen(false)
    } catch (requestError) {
      setError(requestError.message)
      if (requestError.outcome === 'not_committed' && requestError.code === 'TRANSACTION_REJECTED' && attempt && attempt.state !== 'rejected') {
        setReviewOpen(false)
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
          savePendingTransaction('payment', userId, rejectedAttempt)
          setPendingAttempt(rejectedAttempt)
          setRecoveryMessage('This payment was rejected and confirmed not committed. Edit or discard it before starting another payment.')
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
    if (!pendingCustomerMatches || pendingAttempt.state === 'rejected') return
    try {
      const status = await getIdempotencyStatus('payment', pendingAttempt.key)
      if (status.state === 'completed') {
        const responseData = status.response?.data
        validatePaymentResponse(pendingAttempt, responseData)
        let recordedPayment = null
        let warning = ''
        try {
          recordedPayment = await onRecorded(pendingAttempt.display.customer_id, responseData.payment_id)
        } catch (refreshError) {
          warning = `Payment was recorded, but the ledger could not be refreshed: ${refreshError.message}`
        }
        const result = {
          ...responseData,
          payment_date: recordedPayment?.payment_date,
        }
        const completedAttempt = {
          ...pendingAttempt,
          state: 'completed',
          response: result,
        }
        savePendingTransaction('payment', userId, completedAttempt)
        setPendingAttempt(completedAttempt)
        setSuccessResult(result)
        setRefreshWarning(warning)
        setRecoveryMessage('The payment was already recorded. Its original result is ready to review.')
      } else {
        setRecoveryMessage('No completed result was found. Retry the original payment to safely recover or finish it.')
      }
    } catch (statusError) {
      setRecoveryMessage(`${statusError.message}. The saved key is unchanged.`)
    }
  }

  function finishPayment() {
    try {
      clearPendingTransaction('payment', userId)
    } catch (storageError) {
      setError(storageError.message)
      return
    }

    setSuccessResult(null)
    setPendingAttempt(null)
    recoveryChecked.current = false
    setAmount('')
    setSaleId('')
    setRefreshWarning('')
    setError('')
    setRecoveryMessage('')
  }

  function editRejectedPayment() {
    try {
      clearPendingTransaction('payment', userId)
    } catch (storageError) {
      setError(storageError.message)
      return
    }
    setPendingAttempt(null)
    setConfirmEditRejected(false)
    setReviewOpen(false)
    setRecoveryMessage('')
    setError('')
  }

  const successDetails = successResult ? [
    { label: 'Customer name', value: pendingAttempt?.display?.customer_name || customer.customer_name },
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
      {pendingAttempt?.state === 'pending' && pendingCustomerMatches && (
        <div className="payment-feedback" role="status">
          <p>A payment is unresolved. Its original sale and amount are locked to prevent duplicate or changed submissions.</p>
          <p>{recoveryMessage || 'Retry the original payment to recover or finish it.'}</p>
          <button className="secondary-action" type="button" onClick={checkRecoveryStatus} disabled={submitting}>
            Check transaction status
          </button>
        </div>
      )}
      {pendingAttempt && !pendingCustomerMatches && (
        <div className="payment-feedback error" role="alert">
          <p>A saved payment belongs to {pendingAttempt.display?.customer_name || 'another customer'} (Customer ID {pendingAttempt.display?.customer_id || 'unverified'}). It cannot be recovered or shown under {customer.customer_name}.</p>
          {pendingAttempt.display?.customer_id && (
            <button className="secondary-action" type="button" onClick={() => onSelectCustomer?.(pendingAttempt.display.customer_id)}>
              Open {pendingAttempt.display.customer_name}&apos;s ledger
            </button>
          )}
        </div>
      )}
      {pendingAttempt?.state === 'rejected' && pendingCustomerMatches && (
        <div className="payment-feedback error" role="status">
          <p>This payment was rejected and confirmed not committed. Its original details remain saved until you choose to edit it.</p>
          {!confirmEditRejected ? (
            <button className="secondary-action" type="button" onClick={() => setConfirmEditRejected(true)} disabled={submitting}>
              Edit Rejected Payment
            </button>
          ) : (
            <div className="confirmation-actions">
              <span>Clear this rejected attempt? The next submission will use a new key.</span>
              <button className="secondary-action" type="button" onClick={editRejectedPayment}>Confirm Edit</button>
              <button className="secondary-action" type="button" onClick={() => setConfirmEditRejected(false)}>Keep Attempt</button>
            </div>
          )}
        </div>
      )}
      {recoveryMessage && !pendingAttempt && <p className="payment-feedback error" role="alert">{recoveryMessage}</p>}
      <label>
        <span>Credit Sale <b className="required-marker" aria-hidden="true">*</b></span>
        <select value={saleId} onChange={(event) => { setSaleId(event.target.value); setError('') }} disabled={submitting || recoveryBlocked || Boolean(pendingAttempt) || !openCredits.length}>
          <option value="">Select unpaid credit sale</option>
          {openCredits.map((credit) => <option key={credit.sale_id} value={credit.sale_id}>OR-{credit.sale_id} - {peso.format(Number(credit.remaining_balance))}</option>)}
        </select>
      </label>
      <label>
        <span>Payment Amount <b className="required-marker" aria-hidden="true">*</b></span>
        <input type="number" inputMode="decimal" min="0.01" max={selectedCredit ? Number(selectedCredit.remaining_balance) : undefined} step="0.01" placeholder="0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setError('') }} disabled={submitting || recoveryBlocked || Boolean(pendingAttempt) || !openCredits.length} />
      </label>
      {selectedCredit && (
        <div className="payment-balance-preview">
          <span>Selected sale outstanding balance</span>
          <strong>{peso.format(Number(selectedCredit.remaining_balance))}</strong>
        </div>
      )}
      {!openCredits.length && <p className="payment-settled-note">This customer has no unpaid credit sales.</p>}
      {error && !reviewOpen && <p className="payment-feedback error" role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={handleReview} disabled={submitting || recoveryBlocked || (!pendingAttempt && !openCredits.length) || Boolean(successResult) || pendingAttempt?.state === 'completed' || pendingAttempt?.state === 'rejected'}>
        {pendingAttempt?.state === 'pending' ? 'Retry Pending Payment' : 'Review Payment'}
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
      {successResult && pendingCustomerMatches && (
        <TransactionSuccessModal type="payment" details={successDetails} notice={refreshWarning} onDone={finishPayment} />
      )}
    </div>
  )
}

export default PaymentForm
