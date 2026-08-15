import StatCard from '../Shared/StatCard.jsx'
import { peso } from '../../utils/currency.js'

function CreditStats() {
  return (
    <div className="stats-grid compact full-span">
      <StatCard label="Receivables Book Value" value={peso.format(4650)} />
      <StatCard label="Active Debtors" value="2" />
      <StatCard label="Overall Credit Recovery" value="67%" />
    </div>
  )
}

export default CreditStats
