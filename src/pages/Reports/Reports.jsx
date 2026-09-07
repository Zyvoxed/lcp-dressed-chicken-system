import { useState } from 'react'
import InventoryValuation from './InventoryValuation.jsx'
import ReceivablesLedger from './ReceivablesLedger.jsx'
import ReportsTabs from './ReportsTabs.jsx'
import RevenueReport from './RevenueReport.jsx'
import { FileChartColumn } from 'lucide-react'
import PageIntro from '../Shared/PageIntro.jsx'

function Reports() {
  const [activeTab, setActiveTab] = useState('Sales & Revenue Audit')

  return (
    <section className="page-stack">
      <PageIntro icon={FileChartColumn} title="Reports" description="Review revenue, inventory valuation, and customer receivables." />
      <ReportsTabs activeTab={activeTab} onSelect={setActiveTab} />
      {activeTab === 'Sales & Revenue Audit' && <RevenueReport />}
      {activeTab === 'Inventory Assets Valuation' && <InventoryValuation />}
      {activeTab === 'Credit Receivables Ledger' && <ReceivablesLedger />}
    </section>
  )
}

export default Reports
