import { Archive, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Modal from '../Shared/Modal.jsx'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

const columns = [
  'Customer Name',
  'Contact Number',
  'Total Credit',
  'Total Paid',
  'Outstanding Balance',
  'Last Payment',
  'Status',
]

const sortAccessors = [
  (customer) => customer.customer_name,
  (customer) => customer.contact_number,
  (customer) => Number(customer.total_credit),
  (customer) => Number(customer.total_paid),
  (customer) => Number(customer.current_balance),
  (customer) => customer.last_payment_at || '',
  (customer) => Number(customer.current_balance) > 0 ? 'Unpaid' : 'Paid',
]

function CustomerList({ customers, onSelect, onAddCustomer, onShowArchived, archivedCount = 0, isAdmin }) {
  const [query, setQuery] = useState('')
  const [balanceFilter, setBalanceFilter] = useState('All')
  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return customers.filter((customer) => {
      const hasBalance = Number(customer.current_balance) > 0
      const matchesBalance = balanceFilter === 'All'
        || (balanceFilter === 'Outstanding' && hasBalance)
        || (balanceFilter === 'Clear' && !hasBalance)
      const matchesQuery = !normalizedQuery || [
        customer.customer_name,
        customer.contact_number,
        customer.address,
        customer.customer_id,
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
      return matchesBalance && matchesQuery
    })
  }, [balanceFilter, customers, query])

  return (
    <article className="panel customer-list-panel">
      <div className="customer-list-heading">
        <div>
          <h2>CUSTOMERS</h2>
          <p>Select a customer to review their balance, record a payment, or view sales history.</p>
        </div>
        <div className="customer-list-actions">
          <button className="primary-action slim" type="button" onClick={onAddCustomer}>
            <Plus size={15} aria-hidden="true" /> Add Customer
          </button>
          {isAdmin && <button className="secondary-action slim" type="button" onClick={onShowArchived}>
            <Archive size={15} aria-hidden="true" />
            <span>Archived Customers</span>
            {archivedCount > 0 && <span className="customer-archived-badge">{archivedCount}</span>}
          </button>}
        </div>
      </div>
      <div className="customer-list-controls">
        <label className="table-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search customers"
            aria-label="Search customers"
          />
        </label>
        <select
          value={balanceFilter}
          onChange={(event) => setBalanceFilter(event.target.value)}
          aria-label="Filter customers by balance"
        >
          <option value="All">All Customers</option>
          <option value="Outstanding">With Outstanding Balance</option>
          <option value="Clear">Fully Paid</option>
        </select>
        <span className="customer-list-summary" aria-live="polite">
          {filteredCustomers.length} {filteredCustomers.length === 1 ? 'customer' : 'customers'}
        </span>
      </div>
      {!customers.length
        ? <EmptyState>No registered customers found.</EmptyState>
        : !filteredCustomers.length
          ? <EmptyState>No matching customers found.</EmptyState>
          : (
            <DataTable
              columns={columns}
              rows={filteredCustomers}
              pageSize={8}
              searchable={false}
              getSortValue={(customer, columnIndex) => sortAccessors[columnIndex]?.(customer) ?? ''}
              renderRow={(customer) => {
                const outstanding = Number(customer.current_balance)
                return (
                  <tr
                    className="customer-selection-row"
                    key={customer.customer_id}
                    aria-label={`View details for ${customer.customer_name}`}
                    onClick={() => onSelect(customer)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(customer)
                      }
                    }}
                    tabIndex={0}
                  >
                    <td><strong className="customer-table-name">{customer.customer_name}</strong></td>
                    <td>{customer.contact_number || '—'}</td>
                    <td>{peso.format(Number(customer.total_credit || 0))}</td>
                    <td>{peso.format(Number(customer.total_paid || 0))}</td>
                    <td className={outstanding > 0 ? 'customer-table-outstanding' : ''}>
                      <strong>{peso.format(outstanding)}</strong>
                    </td>
                    <td>
                      {customer.last_payment_at
                        ? formatActivityTimestamp(customer.last_payment_at).dateTime
                        : '—'}
                    </td>
                    <td><StatusBadge value={outstanding > 0 ? 'Unpaid' : 'Paid'} /></td>
                  </tr>
                )
              }}
            />
          )}
    </article>
  )
}

export function ArchivedCustomerPanel({ customers, loading, error, onClose, onRestore }) {
  const [customerToRestore, setCustomerToRestore] = useState(null)
  const [restoreError, setRestoreError] = useState('')
  const [restoring, setRestoring] = useState(false)
  const reduceMotion = useReducedMotion()

  async function confirmRestore() {
    if (!customerToRestore || restoring) return
    setRestoring(true)
    setRestoreError('')
    try {
      await onRestore(customerToRestore)
      setCustomerToRestore(null)
    } catch (requestError) {
      setRestoreError(requestError.message || 'Unable to restore customer')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <motion.div
      className="customer-archived-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <motion.aside
        className="customer-archived-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-archived-title"
        initial={{ x: reduceMotion ? 0 : '100%' }}
        animate={{ x: 0 }}
        exit={{ x: reduceMotion ? 0 : '100%' }}
        transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="customer-archived-header">
          <div className="customer-archived-heading">
            <span className="customer-archived-icon"><Archive size={17} aria-hidden="true" /></span>
            <div>
              <p className="customer-archived-kicker">Customer records</p>
              <h2 id="customer-archived-title">Archived customers</h2>
              <p className="customer-archived-description">Review archived records and restore customers when needed.</p>
            </div>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Close archived customers panel"><X size={18} aria-hidden="true" /></button>
        </div>
        {loading
          ? <div className="loading-state" role="status"><i aria-hidden="true" /> Loading archived customers…</div>
          : error
            ? <EmptyState>{error}</EmptyState>
            : !customers.length
              ? <EmptyState>No archived customers found.</EmptyState>
                : <div className="customer-archived-table">
                  <DataTable
                    columns={['Customer', 'Contact number', 'Address', 'Status', 'Action']}
                    rows={customers}
                    pageSize={8}
                    searchPlaceholder="Search archived customers"
                    getSortValue={(customer, columnIndex) => [
                      customer.customer_name,
                      customer.contact_number,
                      customer.address,
                      'Archived',
                      '',
                    ][columnIndex] ?? ''}
                    renderRow={(customer) => (
                      <tr key={customer.customer_id}>
                        <td>
                          <div className="customer-archived-name">
                            <strong>{customer.customer_name}</strong>
                            <span>CUS-{customer.customer_id}</span>
                          </div>
                        </td>
                        <td>{customer.contact_number || 'Not provided'}</td>
                        <td className="customer-archived-address">{customer.address || 'Not provided'}</td>
                        <td><StatusBadge value="Archived" /></td>
                        <td>
                          <button className="secondary-action slim customer-archived-restore" type="button" onClick={() => { setRestoreError(''); setCustomerToRestore(customer) }}><RotateCcw size={14} aria-hidden="true" /> Restore</button>
                        </td>
                      </tr>
                    )}
                  />
                </div>}
      </motion.aside>
      {customerToRestore && (
        <Modal
          title="Restore Customer"
          onClose={() => {
            if (!restoring) {
              setCustomerToRestore(null)
              setRestoreError('')
            }
          }}
          className="customer-restore-confirmation-modal"
          backdropClassName="customer-restore-confirmation-backdrop"
        >
          <p>
            Restore <strong>{customerToRestore.customer_name}</strong> to the active customer list?
          </p>
          <p className="customer-restore-confirmation-subtext">
            Restoring this customer makes them available again for new business transactions.
          </p>
          {restoreError && <p className="form-error" role="alert">{restoreError}</p>}
          <div className="customer-restore-confirmation-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => { setCustomerToRestore(null); setRestoreError('') }}
              disabled={restoring}
            >
              Cancel
            </button>
            <button className="primary-action" type="button" onClick={confirmRestore} disabled={restoring}>
              {restoring ? 'Restoring…' : 'Confirm Restore'}
            </button>
          </div>
        </Modal>
      )}
    </motion.div>
  )
}

export default CustomerList
