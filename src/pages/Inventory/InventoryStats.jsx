import StatCard from '../Shared/StatCard.jsx'

function InventoryStats() {
  return (
    <div className="stats-grid compact inventory-stats">
      <StatCard label="Active Products" value="8" />
      <StatCard label="Low Stock Alerts" value="3" />
      <StatCard label="Out of Stock Products" value="1" />
    </div>
  )
}

export default InventoryStats
