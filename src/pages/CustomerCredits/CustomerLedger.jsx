import { useEffect, useState } from 'react'
import { Archive, RotateCcw, X } from 'lucide-react'
import { motion } from 'framer-motion'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import Modal from '../Shared/Modal.jsx'
import PaymentForm from './PaymentForm.jsx'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

const salesColumns = [
  'Sale ID',
  'Sale Date',
  'Items',
  'Total Amount',
  'Payment Type',
  'Amount Paid',
  'Remaining Balance',
  'Status',
]

const salesSortAccessors = [
  (sale) => Number(sale.sale_id),
  (sale) => sale.sale_date,
  (sale) => Number(sale.item_count),
  (sale) => Number(sale.total_amount),
  (sale) => sale.payment_type,
  (sale) => Number(sale.amount_paid),
  (sale) => Number(sale.remaining_balance),
  (sale) => sale.status,
]

function CustomerLedger({
  customer,
  credits,
  payments,
  sales,
  onPayment,
  onSelectCustomer,
  onClose,
  loading,
  error,
  salesLoading,
  salesError,
  isAdmin,
  onArchive,
  onRestore,
}) {
  const [activeSection, setActiveSection] = useState('Record Payment')
  const [confirmation, setConfirmation] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const archived = customer.is_active === false || customer.is_active === 0

  async function confirmStatusChange() {
    setActionBusy(true)
    setActionError('')
    try {
      if (confirmation === 'archive') await onArchive(customer)
      else await onRestore(customer)
      setConfirmation('')
    } catch (error) {
      setActionError(error.message || 'Unable to update customer status')
    } finally {
      setActionBusy(false)
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <motion.div
      className="customer-drawer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.aside
        className="customer-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-drawer-title"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <header className="customer-drawer-header">
          <div className="customer-drawer-identity">
            <span className="customer-drawer-kicker">Customer credits</span>
            <h2 id="customer-drawer-title">{customer.customer_name}</h2>
            <p>
              Customer ID {customer.customer_id}
              {customer.contact_number ? ` · ${customer.contact_number}` : ''}
            </p>
          </div>
          <div className="customer-drawer-header-actions">
            {isAdmin && (archived
              ? <button className="secondary-action slim" type="button" onClick={() => { setConfirmation('restore'); setActionError('') }}><RotateCcw size={14} aria-hidden="true" /> Restore</button>
              : <button className="secondary-action slim" type="button" onClick={() => { setConfirmation('archive'); setActionError('') }}><Archive size={14} aria-hidden="true" /> Archive</button>)}
            <button className="close-button" type="button" onClick={onClose} aria-label="Close customer details">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className="customer-information" aria-label="Customer information">
          <dl className="customer-information-grid">
            <div><dt>Status</dt><dd><StatusBadge value={archived ? 'Archived' : 'Active'} /></dd></div>
            <div><dt>Contact number</dt><dd>{customer.contact_number || 'Not provided'}</dd></div>
            <div className="wide"><dt>Address</dt><dd>{customer.address || 'Not provided'}</dd></div>
            {customer.created_at && <div className="wide"><dt>Registered</dt><dd>{formatActivityTimestamp(customer.created_at).dateTime}</dd></div>}
          </dl>
        </section>

        <section className="customer-drawer-summary" aria-label="Customer balance summary">
          <div>
            <span>Total Credit</span>
            <strong>{peso.format(Number(customer.total_credit || 0))}</strong>
          </div>
          <div>
            <span>Total Paid</span>
            <strong>{peso.format(Number(customer.total_paid || 0))}</strong>
          </div>
          <div className="outstanding">
            <span>Outstanding Balance</span>
            <strong>{peso.format(Number(customer.current_balance))}</strong>
          </div>
        </section>

        <nav className="customer-drawer-tabs" aria-label="Customer details sections">
          {['Record Payment', 'Sales History'].map((section) => (
            <button
              key={section}
              className={activeSection === section ? 'active' : ''}
              type="button"
              onClick={() => setActiveSection(section)}
              aria-current={activeSection === section ? 'page' : undefined}
            >
              {section}
            </button>
          ))}
        </nav>

        <div className="customer-drawer-content">
          {activeSection === 'Record Payment' && (
            <>
              {loading && <PageSkeleton variant="customer-ledger" label="customer ledger details" />}
              {!loading && error && <EmptyState>{error}</EmptyState>}
              {!loading && !error && Number(customer.current_balance) <= 0 && (
                <p className="payment-settled-note">No outstanding balance. This customer has fully settled their credit.</p>
              )}
              {!loading && !error && Number(customer.current_balance) > 0 && (
                <PaymentForm
                  key={customer.customer_id}
                  customer={customer}
                  credits={credits}
                  onRecorded={onPayment}
                  onSelectCustomer={onSelectCustomer}
                />
              )}
              {!loading && !error && (
                <section className="customer-payment-history" aria-labelledby="customer-payment-history-heading">
                  <h3 id="customer-payment-history-heading">Payment History</h3>
                  {payments.length ? (
                    <div className="customer-payment-history-list">
                      {payments.map((payment) => (
                        <article key={payment.payment_id}>
                          <div>
                            <strong>PAY-{payment.payment_id}</strong>
                            <span>{peso.format(Number(payment.payment_amount))}</span>
                          </div>
                          <p>
                            Applied to OR-{payment.sale_id}
                            {payment.payment_date
                              ? ` · ${formatActivityTimestamp(payment.payment_date).dateTime}`
                              : ''}
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : <p className="history-empty">No payments recorded.</p>}
                </section>
              )}
            </>
          )}

          {activeSection === 'Sales History' && (
            <section className="customer-sales-history" aria-labelledby="customer-sales-history-heading">
              <div className="customer-sales-heading">
                <h3 id="customer-sales-history-heading">Sales History</h3>
                <p>Customer-linked cash and credit transactions.</p>
              </div>
              {salesLoading && <PageSkeleton variant="customer-credits" label="customer sales history" />}
              {!salesLoading && salesError && <EmptyState>{salesError}</EmptyState>}
              {!salesLoading && !salesError && !sales.length && <EmptyState>No sales recorded for this customer.</EmptyState>}
              {!salesLoading && !salesError && sales.length > 0 && (
                <DataTable
                  columns={salesColumns}
                  rows={sales}
                  pageSize={8}
                  searchable={false}
                  getSortValue={(sale, columnIndex) => salesSortAccessors[columnIndex](sale)}
                  renderRow={(sale) => (
                    <tr key={sale.sale_id}>
                      <td><strong>OR-{sale.sale_id}</strong></td>
                      <td>{formatActivityTimestamp(sale.sale_date).dateTime}</td>
                      <td>{sale.item_count}</td>
                      <td>{peso.format(Number(sale.total_amount))}</td>
                      <td>{sale.payment_type}</td>
                      <td>{peso.format(Number(sale.amount_paid))}</td>
                      <td>{peso.format(Number(sale.remaining_balance))}</td>
                      <td><StatusBadge value={sale.status} /></td>
                    </tr>
                  )}
                />
              )}
            </section>
          )}
        </div>
      </motion.aside>
      {confirmation && (
        <Modal
          title={confirmation === 'archive' ? 'Archive Customer' : 'Restore Customer'}
          onClose={() => { if (!actionBusy) setConfirmation('') }}
          className="customer-status-modal"
        >
          <div className="modal-body customer-status-confirmation">
            <p><strong>{customer.customer_name}</strong></p>
            {confirmation === 'archive' ? (
              <>
                <p>Current outstanding balance: <strong>{peso.format(Number(customer.current_balance || 0))}</strong></p>
                {Number(customer.current_balance || 0) > 0 ? (
                  <p className="payment-feedback error" role="alert">This customer must settle the outstanding balance before archiving.</p>
                ) : (
                  <p>Archived customers cannot be selected for new transactions. Historical sales and payment records will be preserved.</p>
                )}
              </>
            ) : <p>Restoring this customer makes them available again for new business transactions.</p>}
            {actionError && <p className="payment-feedback error" role="alert">{actionError}</p>}
            <div className="modal-actions">
              <button className="secondary-action" type="button" disabled={actionBusy} onClick={() => setConfirmation('')}>Cancel</button>
              {(confirmation === 'restore' || Number(customer.current_balance || 0) <= 0) && (
                <button className="primary-action" type="button" disabled={actionBusy} onClick={confirmStatusChange}>
                  {actionBusy ? 'Saving…' : confirmation === 'archive' ? 'Confirm Archive' : 'Confirm Restore'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  )
}

export default CustomerLedger
