import { useMemo, useState } from 'react'
import { salesPerformance } from '../../data/dashboard.js'
import { buildAreaPath, buildSmoothPath } from '../../utils/chartPaths.js'
import { peso } from '../../utils/currency.js'

const chartSize = {
  width: 680,
  height: 280,
  left: 66,
  right: 26,
  top: 24,
  bottom: 56,
}

const rangeTitles = {
  weekly: 'WEEKLY INWARD SALES PERFORMANCE',
  monthly: 'MONTHLY INWARD SALES PERFORMANCE',
}

function buildChartModel(data) {
  const chartBottom = chartSize.height - chartSize.bottom
  const chartWidth = chartSize.width - chartSize.left - chartSize.right
  const chartHeight = chartBottom - chartSize.top
  const maxSales = Math.ceil(Math.max(...data.map((item) => item.sales)) * 1.12 / 10000) * 10000
  const points = data.map((item, index) => ({
    ...item,
    x: chartSize.left + (chartWidth / (data.length - 1)) * index,
    y: chartBottom - (item.sales / maxSales) * chartHeight,
  }))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((percent) => ({
    value: maxSales * percent,
    y: chartBottom - chartHeight * percent,
  }))

  return {
    points,
    ticks,
    linePath: buildSmoothPath(points),
    areaPath: buildAreaPath(points, chartBottom),
  }
}

function SalesChart() {
  const [activePoint, setActivePoint] = useState(null)
  const [range, setRange] = useState('weekly')
  const chartData = salesPerformance[range]
  const chartModel = useMemo(() => buildChartModel(chartData), [chartData])

  return (
    <article className="panel chart-panel">
      <div className="panel-title-row chart-title-row">
        <h2>{rangeTitles[range]}</h2>
        <select
          className="chart-range-select"
          aria-label="Sales chart time range"
          value={range}
          onChange={(event) => {
            setActivePoint(null)
            setRange(event.target.value)
          }}
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div className="chart-canvas">
        {activePoint && (
          <div
            className="chart-tooltip"
            style={{
              left: `${(activePoint.x / chartSize.width) * 100}%`,
              top: `${(activePoint.y / chartSize.height) * 100}%`,
            }}
          >
            <strong>{activePoint.label}</strong>
            <span>Sales: {peso.format(activePoint.sales)}</span>
            <small>Orders: {activePoint.orders}</small>
          </div>
        )}
        <svg
          className="line-chart"
          viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
          role="img"
          aria-label={`${rangeTitles[range]} chart`}
        >
          <defs>
            <linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--orange)" stopOpacity="0.38" />
              <stop offset="100%" stopColor="var(--orange)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {chartModel.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={chartSize.left} x2={chartSize.width - chartSize.right} y1={tick.y} y2={tick.y} />
              <text className="chart-axis-label" x={chartSize.left - 12} y={tick.y + 4} textAnchor="end">
                {peso.format(tick.value)}
              </text>
            </g>
          ))}
          <text className="chart-axis-title" x="18" y="142" transform="rotate(-90 18 142)">
            Sales Amount
          </text>
          <text className="chart-axis-title" x="340" y="274" textAnchor="middle">
            {range === 'weekly' ? 'Week' : 'Month'}
          </text>
          <path d={chartModel.areaPath} className="chart-fill" />
          <path className="chart-line" d={chartModel.linePath} />
          {chartModel.points.map((point) => (
            <g
              className={`chart-point ${activePoint?.label === point.label ? 'active' : ''}`}
              key={point.label}
              role="button"
              tabIndex="0"
              aria-label={`${point.label} sales ${peso.format(point.sales)} orders ${point.orders}`}
              onPointerEnter={() => setActivePoint(point)}
              onPointerLeave={() => setActivePoint(null)}
              onFocus={() => setActivePoint(point)}
              onBlur={() => setActivePoint(null)}
            >
              <circle cx={point.x} cy={point.y} r="5" />
              <text className="chart-x-label" x={point.x} y="250" textAnchor="middle">
                {point.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </article>
  )
}

export default SalesChart
