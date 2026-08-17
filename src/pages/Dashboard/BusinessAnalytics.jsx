import { BarChart3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth.js'
import { getBusinessAnalytics } from '../../services/analyticsService.js'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import BusinessAnalyticsStats from './BusinessAnalyticsStats.jsx'
import ExecutiveOperationsInsights from './ExecutiveOperationsInsights.jsx'
import ProductSalesPerformanceChart from './ProductSalesPerformanceChart.jsx'
import ProductPerformanceLists from './ProductPerformanceLists.jsx'
import RestockWarnings from './RestockWarnings.jsx'

function BusinessAnalytics() {
  const { user } = useAuth()
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    getBusinessAnalytics({ signal: controller.signal }).then(setAnalytics).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])
  if (loading) return <LoadingSpinner />
  if (error) return <EmptyState>{error}</EmptyState>
  if (!analytics) return <EmptyState>No business analytics available.</EmptyState>
  return (
    <section className="business-analytics-page">
      <header className="business-analytics-header"><div><h1><BarChart3 size={24} />Operational Business Analytics</h1><p>Real-time business trends, inventory demand, metrics, and stock intelligence</p></div><span className="analytics-access-badge"><i />Access Level: {user?.role === 'admin' ? 'Admin' : user?.role || 'Unknown'}</span></header>
      <BusinessAnalyticsStats summary={analytics.summary} />
      <div className="business-analytics-main-grid"><ProductSalesPerformanceChart products={analytics.product_performance} /><RestockWarnings products={analytics.restock_alerts} /></div>
      <div className="business-analytics-insights-grid"><ProductPerformanceLists title="TOP-PERFORMING POULTRY PRODUCTS" products={analytics.top_performing} mode="top" /><ProductPerformanceLists title="SLOW-SELLING / LAGGING LISTINGS" products={analytics.slow_selling} mode="slow" /><ExecutiveOperationsInsights insights={analytics.insights} /></div>
    </section>
  )
}
export default BusinessAnalytics
