import { useEffect, useState } from 'react'
import { getBusinessAnalytics } from '../../services/analyticsService.js'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import BusinessAnalyticsStats from './BusinessAnalyticsStats.jsx'
import ExecutiveOperationsInsights from './ExecutiveOperationsInsights.jsx'
import ProductSalesPerformanceChart from './ProductSalesPerformanceChart.jsx'
import ProductPerformanceLists from './ProductPerformanceLists.jsx'
import RestockWarnings from './RestockWarnings.jsx'

function BusinessAnalytics() {
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    getBusinessAnalytics({ signal: controller.signal })
      .then(setAnalytics)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  if (loading) return <div className="panel analytics-page-state" aria-label="Loading business analytics"><LoadingSpinner /></div>
  if (error) return <div className="panel analytics-page-state" role="alert"><EmptyState>{error}</EmptyState></div>
  if (!analytics) return <div className="panel analytics-page-state"><EmptyState>No business analytics available.</EmptyState></div>

  return (
    <section className="business-analytics-page">
      <BusinessAnalyticsStats summary={analytics.summary} />
      <div className="business-analytics-main-grid">
        <ProductSalesPerformanceChart products={analytics.product_performance} />
        <RestockWarnings products={analytics.restock_alerts} />
      </div>
      <div className="business-analytics-insights-grid">
        <ProductPerformanceLists title="PRODUCTS SELLING MOST" products={analytics.top_performing} mode="top" />
        <ProductPerformanceLists title="PRODUCTS SELLING LEAST" products={analytics.slow_selling} mode="slow" />
        <ExecutiveOperationsInsights insights={analytics.insights} />
      </div>
    </section>
  )
}

export default BusinessAnalytics
