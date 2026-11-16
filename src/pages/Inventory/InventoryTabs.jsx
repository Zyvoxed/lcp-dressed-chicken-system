import { Boxes, Truck, History } from 'lucide-react'
import { inventoryTabs } from '../../utils/constants.js'

const tabDetails = {
  'Product List': {
    Icon: Boxes,
    label: 'Product List',
  },
  'Stock In Product (Delivery)': {
    Icon: Truck,
    label: 'Stock In Product (Delivery)',
  },
  'Inflow Records': {
    Icon: History,
    label: 'Inflow Records',
  },
}

function InventoryTabs({ activeTab, onSelect }) {
  return (
    <nav className="inventory-tabs-container" aria-label="Inventory section navigation">
      <div className="inventory-segmented-control" role="tablist" aria-label="Inventory Views">
        {inventoryTabs.map((tab) => {
          const isSelected = activeTab === tab
          const details = tabDetails[tab]
          const Icon = details?.Icon || Boxes
          const label = details?.label || tab

          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              className={`inventory-nav-tab ${isSelected ? 'active' : ''}`}
              onClick={() => onSelect(tab)}
            >
              <span className="inventory-tab-icon">
                <Icon size={16} strokeWidth={isSelected ? 2.2 : 1.8} aria-hidden="true" />
              </span>
              <span className="inventory-tab-label">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default InventoryTabs
