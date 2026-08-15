import { useState } from 'react'
import InventoryValuation from './InventoryValuation.jsx'
import ReceivablesLedger from './ReceivablesLedger.jsx'
import ReportsTabs from './ReportsTabs.jsx'
import RevenueReport from './RevenueReport.jsx'

function Reports() {
  const [activeTab, setActiveTab] = useState('Sales & Revenue Audit')

  return (
    <section className="page-stack">
      <ReportsTabs activeTab={activeTab} onSelect={setActiveTab} />
      {activeTab === 'Sales & Revenue Audit' && <RevenueReport />}
      {activeTab === 'Inventory Assets Valuation' && <InventoryValuation />}
      {activeTab === 'Credit Receivables Ledger' && <ReceivablesLedger />}
    </section>
  )
}

export default Reports
