import { useEffect, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import ProcurementChart from './ProcurementChart.jsx'
import SupplierCard from './SupplierCard.jsx'
import SupplierLedger from './SupplierLedger.jsx'
import SupplierModal from './SupplierModal.jsx'
import { getSuppliers } from '../../services/supplierService.js'
import { getStockInRecords } from '../../services/stockInService.js'
import { Truck } from 'lucide-react'
import PageIntro from '../Shared/PageIntro.jsx'

function SupplierContracts() {
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [records, setRecords] = useState([])
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
        const [supplierData, stockInData] = await Promise.all([
          getSuppliers({ signal: controller.signal }),
          getStockInRecords({ signal: controller.signal }),
        ])
        setSuppliers(supplierData)
        setRecords(stockInData)
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
      <PageIntro icon={Truck} title="Suppliers" description="Review supplier contacts, deliveries, and procurement history." />
      <div className="supplier-grid">
        {loading && <LoadingSpinner />}
        {!loading && error && <EmptyState>{error}</EmptyState>}
        {!loading && !error && !suppliers.length && <EmptyState>No active suppliers found.</EmptyState>}
        {!loading && !error && suppliers.map((supplier, index) => (
          <SupplierCard key={supplier.supplier_id} supplier={supplier} selected={index === 0} />
        ))}
      </div>
      <section className="procurement-layout">
        <ProcurementChart records={records} onSupplierModal={() => setShowSupplierModal(true)} />
        <SupplierLedger records={records} />
      </section>
      {showSupplierModal && (
        <SupplierModal onClose={() => setShowSupplierModal(false)} onCreated={handleSupplierCreated} />
      )}
    </section>
  )
}

export default SupplierContracts
