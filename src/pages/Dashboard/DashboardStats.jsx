import { ClipboardList, Package, ReceiptText, WalletCards } from 'lucide-react'
import { productAnalytics, salesPerformance } from '../../data/dashboard.js'
import { debtors } from '../../data/customers.js'
import { products } from '../../data/products.js'
import { salesLedger } from '../../data/sales.js'
import { peso } from '../../utils/currency.js'
import StatCard from '../Shared/StatCard.jsx'

function DashboardStats({ role }) {
  const revenue = salesLedger.reduce((sum, row) => sum + row[4], 0)
  const receivables = debtors.reduce((sum, row) => sum + row[3], 0)
  const inventoryValue = products.reduce((sum, [, , stock, price]) => sum + stock * price, 0)
  const orderCount = salesLedger.length
  const weeklySales = salesPerformance.weekly.map((item) => item.sales)
  const weeklyOrders = salesPerformance.weekly.map((item) => item.orders)
  const stockMovement = productAnalytics.slice(0, 5).map((product) => product.currentStock)
  const headingPrefix = role === 'admin' ? '' : 'My '

  const stats = [
    {
      label: `${headingPrefix}Revenue`,
      value: peso.format(revenue),
      trend: '+12.4% vs last week',
      icon: ReceiptText,
      sparkline: weeklySales,
    },
    {
      label: 'Sales Orders',
      value: orderCount,
      trend: '+8.2% order velocity',
      icon: ClipboardList,
      sparkline: weeklyOrders,
    },
    {
      label: 'Receivables',
      value: peso.format(receivables),
      trend: '67% collection rate',
      icon: WalletCards,
      sparkline: [9300, 8200, 6400, 5200, receivables],
    },
    {
      label: 'Inventory Value',
      value: peso.format(inventoryValue),
      trend: '3 stock lines need review',
      icon: Package,
      sparkline: stockMovement,
    },
  ]

  return (
    <div className="stats-grid executive-kpis">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  )
}

export default DashboardStats
