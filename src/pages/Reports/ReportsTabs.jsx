import { TrendingUp, Boxes, WalletCards } from 'lucide-react'
import { reportTabs } from '../../utils/constants.js'

const tabDetails = {
  'Sales & Revenue Audit': {
    Icon: TrendingUp,
    label: 'Sales & Revenue Audit',
  },
  'Inventory Assets Valuation': {
    Icon: Boxes,
    label: 'Inventory Assets Valuation',
  },
  'Credit Receivables Ledger': {
    Icon: WalletCards,
    label: 'Credit Receivables Ledger',
  },
}

function ReportsTabs({ activeTab, onSelect }) {
  return (
    <nav className="reports-tabs-container" aria-label="Reports section navigation">
      <div className="reports-segmented-control" role="tablist" aria-label="Report Views">
        {reportTabs.map((tab) => {
          const isSelected = activeTab === tab
          const details = tabDetails[tab]
          const Icon = details?.Icon || TrendingUp
          const label = details?.label || tab

          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              className={`reports-nav-tab ${isSelected ? 'active' : ''}`}
              onClick={() => onSelect(tab)}
            >
              <span className="reports-tab-icon">
                <Icon size={16} strokeWidth={isSelected ? 2.2 : 1.8} aria-hidden="true" />
              </span>
              <span className="reports-tab-label">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default ReportsTabs
