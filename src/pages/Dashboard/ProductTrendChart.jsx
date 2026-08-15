import { useMemo, useState } from 'react'
import {
  productAnalytics,
  productTrendLabels,
  productTrendSeries,
} from '../../data/dashboard.js'
import { buildSmoothPath } from '../../utils/chartPaths.js'

const trendChartSize = {
  width: 680,
  height: 280,
  left: 58,
  right: 26,
  top: 24,
  bottom: 54,
}

function buildTrendModel() {
  const productMap = new Map(productAnalytics.map((product) => [product.product, product]))
  const chartBottom = trendChartSize.height - trendChartSize.bottom
  const chartWidth = trendChartSize.width - trendChartSize.left - trendChartSize.right
  const chartHeight = chartBottom - trendChartSize.top
  const values = productTrendSeries.flatMap((series) => productMap.get(series.product).movement)
  const maxValue = Math.ceil(Math.max(...values) * 1.14 / 20) * 20
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((percent) => ({
    value: Math.round(maxValue * percent),
    y: chartBottom - chartHeight * percent,
  }))
  const series = productTrendSeries.map((line) => {
    const source = productMap.get(line.product)
    const points = source.movement.map((value, index) => ({
      label: productTrendLabels[index],
      value,
      x: trendChartSize.left + (chartWidth / (source.movement.length - 1)) * index,
      y: chartBottom - (value / maxValue) * chartHeight,
      color: line.color,
      seriesName: line.name,
    }))

    return {
      ...line,
      path: buildSmoothPath(points),
      points,
    }
  })

  return { series, ticks }
}

function ProductTrendChart() {
  const [activePoint, setActivePoint] = useState(null)
  const trendModel = useMemo(() => buildTrendModel(), [])

  return (
    <article className="panel chart-panel product-trend-panel">
      <div className="panel-title-row chart-title-row">
        <h2>PRODUCT SALES TREND ANALYSIS</h2>
        <div className="chart-legend" aria-label="Product trend legend">
          {productTrendSeries.map((series) => (
            <span key={series.name}>
              <i style={{ backgroundColor: series.color }} />
              {series.name}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-canvas">
        {activePoint && (
          <div
            className="chart-tooltip product-tooltip"
            style={{
              left: `${(activePoint.x / trendChartSize.width) * 100}%`,
              top: `${(activePoint.y / trendChartSize.height) * 100}%`,
              borderLeftColor: activePoint.color,
            }}
          >
            <strong>{activePoint.seriesName}</strong>
            <span>{activePoint.label}: {activePoint.value} sold</span>
          </div>
        )}
        <svg
          className="line-chart product-trend-chart"
          viewBox={`0 0 ${trendChartSize.width} ${trendChartSize.height}`}
          role="img"
          aria-label="Product sales trend analysis chart"
        >
          {trendModel.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={trendChartSize.left}
                x2={trendChartSize.width - trendChartSize.right}
                y1={tick.y}
                y2={tick.y}
              />
              <text className="chart-axis-label" x={trendChartSize.left - 12} y={tick.y + 4} textAnchor="end">
                {tick.value}
              </text>
            </g>
          ))}
          <text className="chart-axis-title" x="18" y="142" transform="rotate(-90 18 142)">
            Units Sold
          </text>
          <text className="chart-axis-title" x="340" y="274" textAnchor="middle">
            Week
          </text>
          {trendModel.series.map((series) => (
            <g className="product-series" key={series.name} style={{ '--series-color': series.color }}>
              <path className="product-trend-line" d={series.path} />
              {series.points.map((point) => (
                <g
                  className={`chart-point ${activePoint?.seriesName === point.seriesName && activePoint?.label === point.label ? 'active' : ''}`}
                  key={`${point.seriesName}-${point.label}`}
                  role="button"
                  tabIndex="0"
                  aria-label={`${point.seriesName} ${point.label} ${point.value} units sold`}
                  onPointerEnter={() => setActivePoint(point)}
                  onPointerLeave={() => setActivePoint(null)}
                  onFocus={() => setActivePoint(point)}
                  onBlur={() => setActivePoint(null)}
                >
                  <circle cx={point.x} cy={point.y} r="4.5" />
                </g>
              ))}
            </g>
          ))}
          {productTrendLabels.map((label, index) => {
            const chartWidth = trendChartSize.width - trendChartSize.left - trendChartSize.right
            const x = trendChartSize.left + (chartWidth / (productTrendLabels.length - 1)) * index

            return (
              <text className="chart-x-label" x={x} y="250" textAnchor="middle" key={label}>
                {label}
              </text>
            )
          })}
        </svg>
      </div>
    </article>
  )
}

export default ProductTrendChart
