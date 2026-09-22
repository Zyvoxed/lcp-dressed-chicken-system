import { useEffect, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import DashboardStats from './DashboardStats.jsx'
import LowSellingProducts from './LowSellingProducts.jsx'
import RecentActivity from './RecentActivity.jsx'
import RestockChecklist from './RestockChecklist.jsx'
import SalesChart from './SalesChart.jsx'
import SalesSummary from './SalesSummary.jsx'
import TopSellingProducts from './TopSellingProducts.jsx'
import { getDashboard } from '../../services/dashboardService.js'

function Dashboard() {
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    getDashboard({ signal: controller.signal }).then(setDashboard).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  if (loading) return <LoadingSpinner />
  if (error) return <EmptyState>{error}</EmptyState>
  if (!dashboard) return <EmptyState>No dashboard data available.</EmptyState>

  return (
    <section className="page-stack dashboard-page">
      <DashboardStats summary={dashboard.summary} />
      <div className="dashboard-primary-grid">
        <SalesChart trends={dashboard.trends} />
        <SalesSummary summary={dashboard.summary} />
      </div>
      <div className="dashboard-two-column-grid">
        <TopSellingProducts products={dashboard.top_products} />
        <LowSellingProducts products={dashboard.low_products} />
      </div>
      <div className="dashboard-two-column-grid">
        <RestockChecklist products={dashboard.low_stock_alerts} total={dashboard.summary.low_stock_count} />
        <RecentActivity activities={dashboard.recent_activity} />
      </div>
    </section>
  )
}

export default Dashboard
