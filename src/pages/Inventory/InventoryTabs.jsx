import TabBar from '../Shared/TabBar.jsx'
import { inventoryTabs } from '../../utils/constants.js'

function InventoryTabs({ activeTab, onSelect }) {
  return <TabBar tabs={inventoryTabs} active={activeTab} onSelect={onSelect} />
}

export default InventoryTabs
