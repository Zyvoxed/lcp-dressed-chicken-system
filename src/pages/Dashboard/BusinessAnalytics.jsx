import { ArrowRight, Award, Lightbulb, Package, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { productAnalytics } from '../../data/dashboard.js'
import { peso } from '../../utils/currency.js'
import DataTable from '../Shared/DataTable.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import ProductTrendChart from './ProductTrendChart.jsx'

const performanceColumns = [
  'Product',
  'Units Sold',
  'Revenue',
  'Profit',
  'Current Stock',
  'Trend',
  'Status',
]

const trendIcons = {
  Increasing: TrendingUp,
  Decreasing: TrendingDown,
  Stable: ArrowRight,
}

function growthScore(product) {
  return product.movement[product.movement.length - 1] - product.movement[0]
}

function restockScore(product) {
  const trendMultiplier = product.trend === 'Increasing' ? 1.15 : 1

  return (product.unitsSold * trendMultiplier) / Math.max(product.currentStock + 1, 1)
}

function TrendIndicator({ trend }) {
  const Icon = trendIcons[trend] ?? ArrowRight

  return (
    <span className={`trend-indicator ${trend.toLowerCase()}`}>
      <Icon size={15} aria-hidden="true" />
      {trend}
    </span>
  )
}

function BusinessAnalytics() {
  const analytics = useMemo(() => {
    const topSelling = [...productAnalytics]
      .sort((left, right) => right.unitsSold - left.unitsSold)
      .slice(0, 3)
    const lowDemand = productAnalytics
      .filter((product) => product.status === 'Low Demand' || (product.unitsSold <= 80 && product.currentStock > 0))
      .sort((left, right) => left.unitsSold - right.unitsSold)
    const mostSold = topSelling[0]
    const fastestGrowing = [...productAnalytics].sort((left, right) => growthScore(right) - growthScore(left))[0]
    const lowestPerforming = [...productAnalytics].sort((left, right) => left.unitsSold - right.unitsSold)[0]
    const recommendedRestock = [...productAnalytics]
      .filter((product) => product.currentStock > 0)
      .sort((left, right) => restockScore(right) - restockScore(left))[0]

    return {
      topSelling,
      lowDemand,
      insights: [
        { label: 'Most Sold Product', value: mostSold.product, Icon: Award },
        { label: 'Fastest Growing Product', value: fastestGrowing.product, Icon: TrendingUp },
        { label: 'Lowest Performing Product', value: lowestPerforming.product, Icon: TrendingDown },
        { label: 'Recommended Restock', value: recommendedRestock.product, Icon: Package },
      ],
    }
  }, [])

  return (
    <section className="business-analytics-section">
      <div className="section-heading analytics-section-heading">
        <p>Business Analytics</p>
        <span>Product demand intelligence</span>
      </div>

      <div className="analytics-card-grid">
        <article className="panel analytics-card top-products-card">
          <h2>TOP SELLING PRODUCTS</h2>
          <div className="top-products-list">
            {analytics.topSelling.map((product, index) => (
              <div className="top-product-row" key={product.product}>
                <span className="rank-badge">#{index + 1}</span>
                <div>
                  <strong>{product.product}</strong>
                  <span>{product.unitsSold} Sold</span>
                </div>
                <em>{peso.format(product.revenue)} Revenue</em>
              </div>
            ))}
          </div>
        </article>

        <article className="panel analytics-card low-demand-card">
          <h2>LOW DEMAND PRODUCTS</h2>
          <div className="low-demand-list">
            {analytics.lowDemand.map((product) => (
              <div className="low-demand-row" key={product.product}>
                <div>
                  <strong>{product.product}</strong>
                  <span>{product.unitsSold} Sold</span>
                </div>
                <div>
                  <span>{product.currentStock} In Stock</span>
                  <StatusBadge value="Low Demand" />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="panel analytics-card insights-card">
          <div className="analytics-card-title">
            <h2>BEST SELLER INSIGHTS</h2>
            <Lightbulb size={17} aria-hidden="true" />
          </div>
          <div className="insight-list">
            {analytics.insights.map(({ label, value, Icon }) => (
              <div className="insight-item" key={label}>
                <span className="insight-icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div>
                  <p>{label}</p>
                  <strong>{value}</strong>
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      <ProductTrendChart />

      <article className="panel table-panel analytics-table-panel">
        <h2>PRODUCT PERFORMANCE ANALYTICS</h2>
        <DataTable
          columns={performanceColumns}
          rows={productAnalytics}
          renderRow={(product) => (
            <tr key={product.product}>
              <td>
                <strong className="analytics-product-name">{product.product}</strong>
              </td>
              <td>{product.unitsSold}</td>
              <td>{peso.format(product.revenue)}</td>
              <td>{peso.format(product.profit)}</td>
              <td>{product.currentStock} kg</td>
              <td>
                <TrendIndicator trend={product.trend} />
              </td>
              <td>
                <StatusBadge value={product.status} />
              </td>
            </tr>
          )}
        />
      </article>
    </section>
  )
}

export default BusinessAnalytics
