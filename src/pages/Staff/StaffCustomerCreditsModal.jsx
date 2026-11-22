import { useEffect, useMemo, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import Modal from '../Shared/Modal.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { getCustomer, getCustomerCredits, getCustomerPayments } from '../../services/customerService.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import './StaffCustomerCreditsModal.css'

const EMPTY_ROWS = []

function validCustomerId(value) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function dateTime(value) {
  if (!value) return '—'
  return formatActivityTimestamp(value).dateTime
}

function money(value) {
  if (value === null || value === undefined || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? peso.format(amount) : '—'
}

function StaffCustomerCreditsModal({ customer, onClose }) {
  const customerId = validCustomerId(customer?.customer_id)
  const [status, setStatus] = useState(customerId ? 'loading' : 'error')
  const [customerDetails, setCustomerDetails] = useState(null)
  const [credits, setCredits] = useState([])
  const [payments, setPayments] = useState([])
  const [error, setError] = useState(customerId ? '' : 'Invalid customer reference.')
  const [retryVersion, setRetryVersion] = useState(0)
  const [loadedCustomerId, setLoadedCustomerId] = useState(null)

  // Internal tab: "credits" or "payments"
  const [activeModalTab, setActiveModalTab] = useState('credits')

  useEffect(() => {
    if (!customerId) return undefined
    const controller = new AbortController()
    async function loadCustomerDetails() {
      setStatus('loading')
      setLoadedCustomerId(null)
      setCustomerDetails(null)
      setCredits([])
      setPayments([])
      setError('')
      try {
        const [customerRecord, creditRows, paymentRows] = await Promise.all([
          getCustomer(customerId, { signal: controller.signal }),
          getCustomerCredits(customerId, { signal: controller.signal }),
          getCustomerPayments(customerId, { signal: controller.signal }),
        ])
        if (!controller.signal.aborted) {
          setCustomerDetails(customerRecord)
          setCredits(creditRows || [])
          setPayments(paymentRows || [])
          setError('')
          setStatus('ready')
          setLoadedCustomerId(customerId)
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setCustomerDetails(null)
          setCredits([])
          setPayments([])
          setError(requestError.message || 'Unable to retrieve customer credit details.')
          setStatus('error')
          setLoadedCustomerId(customerId)
        }
      }
    }
    loadCustomerDetails()
    return () => controller.abort()
  }, [customerId, retryVersion])

  useEffect(() => {
    const backdrop = document.querySelector('.staff-credit-modal-backdrop')
    if (!backdrop) return undefined

    function handleBackdropClick(event) {
      if (event.target === backdrop) onClose()
    }

    backdrop.addEventListener('click', handleBackdropClick)
    return () => backdrop.removeEventListener('click', handleBackdropClick)
  }, [onClose])

  const currentCustomerLoaded = loadedCustomerId === customerId
  const viewStatus = !customerId ? 'error' : currentCustomerLoaded ? status : 'loading'
  const visibleCredits = currentCustomerLoaded ? credits : EMPTY_ROWS
  const visiblePayments = currentCustomerLoaded ? payments : EMPTY_ROWS
  const visibleCustomerDetails = currentCustomerLoaded ? customerDetails : null

  const openCreditCount = useMemo(
    () => visibleCredits.filter((credit) => credit.status === 'Unpaid' || credit.status === 'Partially Paid').length,
    [visibleCredits],
  )

  const totalCreditIssued = useMemo(
    () => visibleCredits.reduce((sum, credit) => sum + Number(credit.total_amount || 0), 0),
    [visibleCredits],
  )

  const totalPayments = useMemo(
    () => visiblePayments.reduce((sum, payment) => sum + Number(payment.payment_amount || 0), 0),
    [visiblePayments],
  )

  const currentBalance = visibleCustomerDetails ? Number(visibleCustomerDetails.current_balance || 0) : 0

  const customerName = visibleCustomerDetails?.customer_name || customer?.customer_name || 'Customer'

  return (
    <Modal
      title="Customer Credit Ledger"
      onClose={onClose}
      className="staff-credit-detail-modal"
      backdropClassName="staff-credit-modal-backdrop"
    >
      <div className="staff-credit-modal-content">
        <section className="staff-credit-profile-banner" aria-label="Selected customer">
          <h3 className="staff-credit-customer-title">{customerName}</h3>
          <span className="staff-credit-customer-id">Customer ID #{customerId || '—'}</span>
        </section>

        {/* Customer credit summary */}
        <section className="staff-credit-modal-summary" aria-label="Customer credit summary metrics">
          <article className="staff-credit-summary-card accent-balance">
            <div className="staff-credit-card-header">
              <span className="staff-credit-summary-label">Outstanding Balance</span>
            </div>
            <strong className="staff-credit-summary-value">
              {visibleCustomerDetails ? peso.format(currentBalance) : '—'}
            </strong>
          </article>

          <article className="staff-credit-summary-card">
            <div className="staff-credit-card-header">
              <span className="staff-credit-summary-label">Total Credit Issued</span>
            </div>
            <strong className="staff-credit-summary-value">
              {viewStatus === 'ready' ? money(totalCreditIssued) : '—'}
            </strong>
          </article>

          <article className="staff-credit-summary-card">
            <div className="staff-credit-card-header">
              <span className="staff-credit-summary-label">Total Paid</span>
            </div>
            <strong className="staff-credit-summary-value">
              {viewStatus === 'ready' ? money(totalPayments) : '—'}
            </strong>
          </article>

          <article className="staff-credit-summary-card">
            <div className="staff-credit-card-header">
              <span className="staff-credit-summary-label">Open Credits</span>
            </div>
            <strong className="staff-credit-summary-value">
              {viewStatus === 'ready' ? openCreditCount.toLocaleString('en-PH') : '—'}
            </strong>
          </article>
        </section>

        {viewStatus === 'loading' && (
          <PageSkeleton variant="report-receivables" label="customer credit details" />
        )}

        {viewStatus === 'error' && (
          <div className="staff-credit-modal-error" role="alert">
            <EmptyState>{error}</EmptyState>
            {customerId && (
              <button
                className="secondary-action slim"
                type="button"
                onClick={() => {
                  setStatus('loading')
                  setRetryVersion((current) => current + 1)
                }}
              >
                Try Again
              </button>
            )}
          </div>
        )}

        {viewStatus === 'ready' && (
          <>
            {/* View Switcher Bar */}
            <div className="staff-credit-view-switcher">
              <div className="staff-credit-tab-pills" role="tablist" aria-label="Customer activity views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeModalTab === 'credits'}
                  className={`staff-credit-tab-btn ${activeModalTab === 'credits' ? 'active' : ''}`}
                  onClick={() => setActiveModalTab('credits')}
                >
                  <span>Credit Transactions</span>
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={activeModalTab === 'payments'}
                  className={`staff-credit-tab-btn ${activeModalTab === 'payments' ? 'active' : ''}`}
                  onClick={() => setActiveModalTab('payments')}
                >
                  <span>Payment History</span>
                </button>
              </div>
            </div>

            {/* View 1: Credit Transactions */}
            {activeModalTab === 'credits' && (
              <section aria-label="Credit Transactions" className="staff-credit-table-section">
                <div className="staff-credit-table-wrap" data-kind="credits">
                {!visibleCredits.length ? (
                  <EmptyState>
                    No credit transactions recorded for this customer.
                  </EmptyState>
                ) : (
                  <DataTable
                    columns={['Reference', 'Sale Date', 'Credit Amount', 'Amount Paid', 'Remaining Balance', 'Status']}
                    rows={visibleCredits}
                    pageSize={6}
                    searchable={false}
                    nonSortableColumns={['Reference', 'Sale Date', 'Credit Amount', 'Amount Paid', 'Remaining Balance', 'Status']}
                    getSortValue={(credit, index) =>
                      [
                        Number(credit.sale_id),
                        credit.sale_date,
                        Number(credit.total_amount),
                        Number(credit.amount_paid),
                        Number(credit.remaining_balance),
                        credit.status,
                      ][index]
                    }
                    renderRow={(credit) => (
                      <tr key={credit.sale_id}>
                        <td data-label="Reference">
                          <strong className="staff-credit-mono-ref">OR-{credit.sale_id}</strong>
                        </td>
                        <td data-label="Sale Date">
                          <time dateTime={credit.sale_date}>{dateTime(credit.sale_date)}</time>
                        </td>
                        <td data-label="Credit Amount" className="cell-right font-mono">{money(credit.total_amount)}</td>
                        <td data-label="Amount Paid" className="cell-right font-mono">{money(credit.amount_paid)}</td>
                        <td data-label="Remaining Balance" className="cell-right font-mono">
                          <strong style={{ color: Number(credit.remaining_balance) > 0 ? 'var(--primary)' : 'inherit' }}>
                            {money(credit.remaining_balance)}
                          </strong>
                        </td>
                        <td data-label="Status">
                          <StatusBadge value={credit.status} />
                        </td>
                      </tr>
                    )}
                  />
                )}
                </div>
              </section>
            )}

            {/* View 2: Payment History */}
            {activeModalTab === 'payments' && (
              <section aria-label="Payment History" className="staff-credit-table-section">
                <div className="staff-credit-table-wrap" data-kind="payments">
                {!visiblePayments.length ? (
                  <EmptyState>
                    No payment records are available for this customer.
                  </EmptyState>
                ) : (
                  <DataTable
                    columns={['Payment Reference', 'Credit Reference', 'Payment Date', 'Payment Amount', 'Remaining Balance', 'Recorded By']}
                    rows={visiblePayments}
                    pageSize={6}
                    searchable={false}
                    nonSortableColumns={['Payment Reference', 'Credit Reference', 'Payment Date', 'Payment Amount', 'Remaining Balance', 'Recorded By']}
                    getSortValue={(payment, index) =>
                      [
                        Number(payment.payment_id),
                        Number(payment.sale_id),
                        payment.payment_date,
                        Number(payment.payment_amount),
                        Number(payment.remaining_balance),
                        payment.recorded_by,
                      ][index]
                    }
                    renderRow={(payment) => (
                      <tr key={payment.payment_id}>
                        <td data-label="Payment Reference">
                          <strong className="staff-credit-payment-ref">PAY-{payment.payment_id}</strong>
                        </td>
                        <td data-label="Credit Reference">
                          <span className="staff-credit-mono-ref">OR-{payment.sale_id}</span>
                        </td>
                        <td data-label="Payment Date">
                          <time dateTime={payment.payment_date}>{dateTime(payment.payment_date)}</time>
                        </td>
                        <td data-label="Payment Amount" className="cell-right font-mono">{money(payment.payment_amount)}</td>
                        <td data-label="Remaining Balance" className="cell-right font-mono">{money(payment.remaining_balance)}</td>
                        <td data-label="Recorded By">{payment.recorded_by || '—'}</td>
                      </tr>
                    )}
                  />
                )}
                </div>
              </section>
            )}
          </>
        )}

      </div>
      <footer className="staff-credit-modal-footer">
        <button type="button" className="secondary-action" onClick={onClose}>
          Close
        </button>
      </footer>
    </Modal>
  )
}

export default StaffCustomerCreditsModal
