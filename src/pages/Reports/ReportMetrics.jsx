import StatCard from '../Shared/StatCard.jsx'
import { peso } from '../../utils/currency.js'

function ReportMetrics() {
  return (
    <div className="stats-grid report-stats">
      <StatCard label="Gross Revenue Invoice" value={peso.format(25100)} />
      <StatCard label="Cash Upfront Received" value={peso.format(16800)} />
      <StatCard label="Ledger Debt Created" value={peso.format(4650)} />
      <StatCard label="Debt Ledger Payments" value={peso.format(3300)} />
      <StatCard label="Net Fluid Cash Inflow" value={peso.format(20100)} />
    </div>
  )
}

export default ReportMetrics
