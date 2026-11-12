import { useContext, useEffect, useMemo, useState } from 'react'
import { Archive, Plus, Search, X } from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import Modal from '../Shared/Modal.jsx'
import ProcurementChart from './ProcurementChart.jsx'
import SupplierCard from './SupplierCard.jsx'
import SupplierLedger from './SupplierLedger.jsx'
import SupplierModal from './SupplierModal.jsx'
import { archiveSupplier, getArchivedSuppliers, getSuppliers, restoreSupplier } from '../../services/supplierService.js'
import { getStockInRecords } from '../../services/stockInService.js'
import { AuthContext } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'

function SupplierContracts() {
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [archivedSuppliers, setArchivedSuppliers] = useState([])
  const [records, setRecords] = useState([])
  const [query, setQuery] = useState('')
  const [showArchivedPanel, setShowArchivedPanel] = useState(false)
  const [archivedSuppliersLoading, setArchivedSuppliersLoading] = useState(false)
  const [archivedSuppliersError, setArchivedSuppliersError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const { showSuccess, showError, showWarning } = useToast()
  const auth = useContext(AuthContext)
  const isAdmin = auth?.user?.role === 'admin'
  const [suppliersLoading, setSuppliersLoading] = useState(true)
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [supplierError, setSupplierError] = useState('')
  const [recordsError, setRecordsError] = useState('')

  async function refreshSuppliers() {
    try {
      const [active, archived] = await Promise.all([getSuppliers(), getArchivedSuppliers()])
      setSuppliers(active)
      setArchivedSuppliers(archived)
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

    Promise.all([
      getSuppliers({ signal: controller.signal }),
      getArchivedSuppliers({ signal: controller.signal }),
    ])
      .then(([active, archived]) => { setSuppliers(active); setArchivedSuppliers(archived); setSupplierError('') })
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

  useEffect(() => {
    if (!showArchivedPanel) return undefined
    const controller = new AbortController()
    async function loadArchivedSuppliers() {
      setArchivedSuppliersLoading(true)
      setArchivedSuppliersError('')
      try {
        setArchivedSuppliers(await getArchivedSuppliers({ signal: controller.signal }))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setArchivedSuppliersError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setArchivedSuppliersLoading(false)
      }
    }
    loadArchivedSuppliers()
    return () => controller.abort()
  }, [showArchivedPanel])

  async function confirmStatusChange() {
    if (!confirmation || actionBusy) return
    setActionBusy(true)
    setActionError('')
    try {
      const { action, supplier } = confirmation
      await (action === 'archive' ? archiveSupplier(supplier.supplier_id) : restoreSupplier(supplier.supplier_id))
      const refreshWarning = await refreshSuppliers()
      showSuccess(`${supplier.supplier_name} was ${action === 'archive' ? 'archived' : 'restored'}.`)
      if (refreshWarning) showWarning(refreshWarning)
      if (action === 'restore') setShowArchivedPanel(false)
      setConfirmation(null)
    } catch (error) {
      showError(error.message || 'Unable to update supplier status')
      setActionError(error.message || 'Unable to update supplier status')
    } finally {
      setActionBusy(false)
    }
  }

  return (
    <section className="supplier-page page-stack">
      <section className="panel supplier-directory-panel">
        <div className="supplier-section-heading">
          <div>
            <h2>Qualified Suppliers</h2>
            <p>Review active supplier contact details and confirmed delivery activity.</p>
          </div>
          <div className="supplier-directory-actions">
            <button className="primary-action slim" type="button" onClick={() => setShowSupplierModal(true)}>
              <Plus size={15} aria-hidden="true" /> Add Supplier
            </button>
            {isAdmin && <button className="secondary-action slim" type="button" onClick={() => setShowArchivedPanel(true)}>
              <Archive size={15} aria-hidden="true" /> Archived Suppliers
            </button>}
          </div>
        </div>

        {!suppliersLoading && !supplierError && suppliers.length > 0 && <div className="supplier-directory-controls">
          <label className="table-search">
            <Search size={15} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search suppliers" aria-label="Search suppliers" />
          </label>
          <span aria-live="polite">{filteredSuppliers.length} {filteredSuppliers.length === 1 ? 'supplier' : 'suppliers'}</span>
        </div>}

        {suppliersLoading && <PageSkeleton variant="supplier-directory" label="supplier directory" />}
        {!suppliersLoading && supplierError && <EmptyState>{supplierError}</EmptyState>}
        {!suppliersLoading && !supplierError && !suppliers.length && <EmptyState>No active suppliers found.</EmptyState>}
        {!suppliersLoading && !supplierError && suppliers.length > 0 && <div className="supplier-grid">
          {!filteredSuppliers.length && <EmptyState>No suppliers match your search.</EmptyState>}
          {filteredSuppliers.map((supplier) => (
            <SupplierCard
              key={supplier.supplier_id}
              supplier={supplier}
              archived={false}
              isAdmin={isAdmin}
              onArchive={(target) => { setConfirmation({ action: 'archive', supplier: target }); setActionError('') }}
              onRestore={(target) => { setConfirmation({ action: 'restore', supplier: target }); setActionError('') }}
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

      {confirmation && (
        <Modal
          title={confirmation.action === 'archive' ? 'Archive Supplier' : 'Restore Supplier'}
          onClose={() => { if (!actionBusy) { setConfirmation(null); setActionError('') } }}
          className="supplier-status-modal"
          backdropClassName={showArchivedPanel ? 'archive-panel-confirmation-backdrop' : ''}
        >
          <div className="supplier-status-confirmation">
            <p><strong>{confirmation.supplier.supplier_name}</strong> · SUP-{confirmation.supplier.supplier_id}</p>
            <p>{confirmation.action === 'archive'
              ? 'This supplier will no longer be available for new Stock In deliveries. Existing delivery history and recorded costs will be preserved.'
              : 'Restoring this supplier makes it available again for new Stock In deliveries.'}</p>
            {actionError && <p className="supplier-form-error" role="alert">{actionError}</p>}
            <div className="modal-actions">
              <button className="secondary-action" type="button" disabled={actionBusy} onClick={() => setConfirmation(null)}>Cancel</button>
              <button className="primary-action" type="button" disabled={actionBusy} onClick={confirmStatusChange}>
                {actionBusy ? 'Saving…' : confirmation.action === 'archive' ? 'Confirm Archive' : 'Confirm Restore'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showArchivedPanel && (
        <div className="inventory-archived-panel-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowArchivedPanel(false) }}>
          <aside className="inventory-archived-panel supplier-archive-panel" role="dialog" aria-modal="true" aria-label="Archived suppliers">
            <div className="inventory-archived-panel-header">
              <div><p className="inventory-archived-kicker">Supplier Contracts</p><h2>Archived Suppliers</h2></div>
              <button className="close-button" type="button" onClick={() => setShowArchivedPanel(false)} aria-label="Close archived suppliers panel"><X size={18} aria-hidden="true" /></button>
            </div>
            {archivedSuppliersLoading
              ? <PageSkeleton variant="supplier-directory" label="archived suppliers" />
              : archivedSuppliersError
                ? <EmptyState>{archivedSuppliersError}</EmptyState>
                : !archivedSuppliers.length
                  ? <EmptyState>No archived suppliers found.</EmptyState>
                  : <div className="supplier-grid archived-supplier-grid">
                    {archivedSuppliers.map((supplier) => (
                      <SupplierCard
                        key={supplier.supplier_id}
                        supplier={supplier}
                        archived
                        isAdmin={isAdmin}
                        onRestore={(target) => { setConfirmation({ action: 'restore', supplier: target }); setActionError('') }}
                        records={records.filter((record) => String(record.supplier_id) === String(supplier.supplier_id))}
                      />
                    ))}
                  </div>}
          </aside>
        </div>
      )}
    </section>
  )
}

export default SupplierContracts
import PageSkeleton from '../Shared/PageSkeleton.jsx'
