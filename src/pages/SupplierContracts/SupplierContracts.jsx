import { useEffect, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import ProcurementChart from './ProcurementChart.jsx'
import SupplierCard from './SupplierCard.jsx'
import SupplierLedger from './SupplierLedger.jsx'
import SupplierModal from './SupplierModal.jsx'
import { getSuppliers } from '../../services/supplierService.js'

function SupplierContracts() {
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function refreshSuppliers() {
    try {
      const data = await getSuppliers()
      setSuppliers(data)
      setError('')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    async function loadSuppliers() {
      try {
        const data = await getSuppliers({ signal: controller.signal })
        setSuppliers(data)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    loadSuppliers()

    return () => controller.abort()
  }, [])

  async function handleSupplierCreated() {
    setShowSupplierModal(false)
    await refreshSuppliers()
  }

  return (
    <section className="page-stack">
      <div className="supplier-grid">
        {loading && <LoadingSpinner />}
        {!loading && error && <EmptyState>{error}</EmptyState>}
        {!loading && !error && !suppliers.length && <EmptyState>No active suppliers found.</EmptyState>}
        {!loading && !error && suppliers.map((supplier, index) => (
          <SupplierCard key={supplier.supplier_id} supplier={supplier} selected={index === 0} />
        ))}
      </div>
      <section className="procurement-layout">
        <ProcurementChart onSupplierModal={() => setShowSupplierModal(true)} />
        <SupplierLedger />
      </section>
      {showSupplierModal && (
        <SupplierModal onClose={() => setShowSupplierModal(false)} onCreated={handleSupplierCreated} />
      )}
    </section>
  )
}

export default SupplierContracts
