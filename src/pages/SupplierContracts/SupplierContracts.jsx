import { useState } from 'react'
import ProcurementChart from './ProcurementChart.jsx'
import SupplierCard from './SupplierCard.jsx'
import SupplierLedger from './SupplierLedger.jsx'
import SupplierModal from './SupplierModal.jsx'
import { suppliers } from '../../data/suppliers.js'

function SupplierContracts() {
  const [showSupplierModal, setShowSupplierModal] = useState(false)

  return (
    <section className="page-stack">
      <div className="supplier-grid">
        {suppliers.map((supplier, index) => (
          <SupplierCard key={supplier[0]} supplier={supplier} selected={index === 0} />
        ))}
      </div>
      <section className="procurement-layout">
        <ProcurementChart onSupplierModal={() => setShowSupplierModal(true)} />
        <SupplierLedger />
      </section>
      {showSupplierModal && <SupplierModal onClose={() => setShowSupplierModal(false)} />}
    </section>
  )
}

export default SupplierContracts
