import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import StatusBadge from '../Shared/StatusBadge.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import { peso } from '../../utils/currency.js'

const pageSize = 6

function CustomerList({ customers, selectedCustomer, onSelect, onAddCustomer }) {
  const [query, setQuery] = useState('')
  const [balanceFilter, setBalanceFilter] = useState('All')
  const [page, setPage] = useState(1)
  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return customers.filter((customer) => {
      const hasBalance = Number(customer.current_balance) > 0
      const matchesBalance = balanceFilter === 'All'
        || (balanceFilter === 'Outstanding' && hasBalance)
        || (balanceFilter === 'Clear' && !hasBalance)
      const matchesQuery = !normalizedQuery || [customer.customer_name, customer.contact_number, customer.address]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery)
      return matchesBalance && matchesQuery
    })
  }, [balanceFilter, customers, query])
  const pageCount = Math.max(Math.ceil(filteredCustomers.length / pageSize), 1)
  const visiblePage = Math.min(page, pageCount)
  const pageCustomers = filteredCustomers.slice((visiblePage - 1) * pageSize, visiblePage * pageSize)

  return (
    <article className="panel customer-list-panel">
      <div className="customer-list-heading">
        <div>
          <h2>CUSTOMERS</h2>
          <p>Select a registered customer to view their credit ledger.</p>
        </div>
        <button className="primary-action slim" type="button" onClick={onAddCustomer}>
          <Plus size={15} aria-hidden="true" /> Add Customer
        </button>
      </div>
      <div className="customer-list-controls">
        <label className="table-search">
          <Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search customers" aria-label="Search customers" />
        </label>
        <select value={balanceFilter} onChange={(event) => { setBalanceFilter(event.target.value); setPage(1) }} aria-label="Filter customers by balance">
          <option value="All">All Customers</option>
          <option value="Outstanding">With Outstanding Balance</option>
          <option value="Clear">No Outstanding Balance</option>
        </select>
      </div>
      <div className="customer-list-summary" aria-live="polite">
        {filteredCustomers.length} {filteredCustomers.length === 1 ? 'customer' : 'customers'}
      </div>
      <div className="debtor-list">
        {!pageCustomers.length && <EmptyState>No matching customers found.</EmptyState>}
        {pageCustomers.map((customer) => {
          const hasBalance = Number(customer.current_balance) > 0
          return (
            <button className={`debtor-row ${selectedCustomer?.customer_id === customer.customer_id ? 'selected' : ''}`} type="button" aria-pressed={selectedCustomer?.customer_id === customer.customer_id} key={customer.customer_id} onClick={() => onSelect(customer)}>
              <div className="debtor-identity">
                <strong>{customer.customer_name}</strong>
                <p>{customer.contact_number || 'No contact number'}</p>
                <span>{customer.address || 'No address recorded'}</span>
              </div>
              <div className="debtor-balance">
                <b>{peso.format(Number(customer.current_balance))}</b>
                <StatusBadge value={hasBalance ? 'Unpaid' : 'Paid'} as="em" />
              </div>
            </button>
          )
        })}
      </div>
      {filteredCustomers.length > pageSize && (
        <div className="customer-pagination">
          <span>Page {visiblePage} of {pageCount}</span>
          <div>
            <button type="button" onClick={() => setPage(Math.max(visiblePage - 1, 1))} disabled={visiblePage === 1} aria-label="Previous customer page"><ChevronLeft size={16} /></button>
            <button type="button" onClick={() => setPage(Math.min(visiblePage + 1, pageCount))} disabled={visiblePage === pageCount} aria-label="Next customer page"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}
    </article>
  )
}

export default CustomerList
