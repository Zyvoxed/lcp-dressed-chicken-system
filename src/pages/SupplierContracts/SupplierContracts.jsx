import { useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import ProcurementChart from './ProcurementChart.jsx'
import SupplierCard from './SupplierCard.jsx'
import SupplierLedger from './SupplierLedger.jsx'
import SupplierModal from './SupplierModal.jsx'
import { getSuppliers } from '../../services/supplierService.js'
import { getStockInRecords } from '../../services/stockInService.js'

function SupplierContracts() {
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [records, setRecords] = useState([])
  const [query, setQuery] = useState('')
  const [suppliersLoading, setSuppliersLoading] = useState(true)
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [supplierError, setSupplierError] = useState('')
  const [recordsError, setRecordsError] = useState('')

  async function refreshSuppliers() {
    try {
      setSuppliers(await getSuppliers())
      setSupplierError('')
      return ''
    } catch (requestError) {
      setSupplierError(requestError.message)
      return `The supplier was saved, but the directory could not be refreshed: ${requestError.message}`
    } finally {
      setSuppliersLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    getSuppliers({ signal: controller.signal })
      .then((data) => { setSuppliers(data); setSupplierError('') })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setSupplierError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setSuppliersLoading(false)
      })

    getStockInRecords({ signal: controller.signal })
      .then((data) => { setRecords(data); setRecordsError('') })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setRecordsError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecordsLoading(false)
      })

    return () => controller.abort()
  }, [])

  const filteredSuppliers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return suppliers
    return suppliers.filter((supplier) => [
      supplier.supplier_name,
      supplier.contact_person,
      supplier.contact_number,
      supplier.address,
    ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery))
  }, [query, suppliers])

  return (
    <section className="supplier-page page-stack">
      <section className="panel supplier-directory-panel">
        <div className="supplier-section-heading">
          <div>
            <h2>Qualified Suppliers</h2>
            <p>Review active supplier contact details and confirmed delivery activity.</p>
          </div>
          <button className="primary-action slim" type="button" onClick={() => setShowSupplierModal(true)}>
            <Plus size={15} aria-hidden="true" /> Add Supplier
          </button>
        </div>

        {!suppliersLoading && !supplierError && suppliers.length > 0 && <div className="supplier-directory-controls">
          <label className="table-search">
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suppliers" aria-label="Search suppliers" />
          </label>
          <span aria-live="polite">{filteredSuppliers.length} {filteredSuppliers.length === 1 ? 'supplier' : 'suppliers'}</span>
        </div>}

        {suppliersLoading && <LoadingSpinner />}
        {!suppliersLoading && supplierError && <EmptyState>{supplierError}</EmptyState>}
        {!suppliersLoading && !supplierError && !suppliers.length && <EmptyState>No active suppliers found.</EmptyState>}
        {!suppliersLoading && !supplierError && suppliers.length > 0 && <div className="supplier-grid">
          {!filteredSuppliers.length && <EmptyState>No suppliers match your search.</EmptyState>}
          {filteredSuppliers.map((supplier) => (
            <SupplierCard
              key={supplier.supplier_id}
              supplier={supplier}
              records={records.filter((record) => String(record.supplier_id) === String(supplier.supplier_id))}
            />
          ))}
        </div>}
      </section>

      <section className="procurement-layout">
        <ProcurementChart records={records} loading={recordsLoading} error={recordsError} />
        <SupplierLedger records={records} loading={recordsLoading} error={recordsError} />
      </section>

      {showSupplierModal && (
        <SupplierModal onClose={() => setShowSupplierModal(false)} onCreated={refreshSuppliers} />
      )}
    </section>
  )
}

export default SupplierContracts
