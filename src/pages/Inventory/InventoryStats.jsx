import { PackageCheck, PackageX, TriangleAlert } from 'lucide-react'
import StatCard from '../Shared/StatCard.jsx'

function InventoryStats({ products, loading, error }) {
  const unavailable = loading || Boolean(error)
  const activeProducts = products.length
  const lowStockProducts = products.filter((product) => product.status === 'Low Stock').length
  const outOfStockProducts = products.filter((product) => product.status === 'Out of Stock').length
  const helper = error ? 'Unavailable' : loading ? 'Loading...' : undefined

  return (
    <div className="stats-grid compact inventory-stats">
      <StatCard
        label="Active Products"
        value={unavailable ? '\u2014' : activeProducts}
        helper={helper}
        icon={PackageCheck}
      />
      <StatCard
        label="Low Stock Alerts"
        value={unavailable ? '\u2014' : lowStockProducts}
        helper={helper}
        icon={TriangleAlert}
      />
      <StatCard
        label="Out of Stock Products"
        value={unavailable ? '\u2014' : outOfStockProducts}
        helper={helper}
        icon={PackageX}
      />
    </div>
  )
}

export default InventoryStats
