import { BarChart3 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { buildMonotonePath } from '../../utils/chartPaths.js'
import { peso } from '../../utils/currency.js'
import EmptyState from '../Shared/EmptyState.jsx'

const chart = {
  height: 310,
  left: 72,
  right: 24,
  top: 28,
  bottom: 54,
}

const rangeOptions = [
  { key: 'daily', label: 'Today', heading: 'Today', grouping: 'hour' },
  { key: 'weekly', label: 'Week', heading: 'Weekly', grouping: 'day' },
  { key: 'monthly', label: 'Month', heading: 'Monthly', grouping: 'calendar day' },
]

const compactPeso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  notation: 'compact',
  maximumFractionDigits: 1,
})

function chartModel(data, chartWidth) {
  const bottom = chart.height - chart.bottom
  const plotWidth = chartWidth - chart.left - chart.right
  const plotHeight = bottom - chart.top
  const normalizedData = data.map((item) => ({
    ...item,
    label: String(item.label ?? ''),
    sales: Math.max(Number(item.sales) || 0, 0),
    transactions: Math.max(Number(item.transactions) || 0, 0),
  }))
  const highest = Math.max(...normalizedData.map((item) => item.sales), 0)
  const maximum = Math.max(Math.ceil((highest * 1.15) / 1000) * 1000, 1000)
  const points = normalizedData.map((item, index) => ({
    ...item,
    x: normalizedData.length === 1
      ? chart.left + (plotWidth / 2)
      : chart.left + (plotWidth / (normalizedData.length - 1)) * index,
    y: bottom - (item.sales / maximum) * plotHeight,
  }))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    value: maximum * fraction,
    y: bottom - plotHeight * fraction,
  }))

  return { bottom, path: buildMonotonePath(points), points, ticks }
}

function hitArea(points, index, chartWidth) {
  const point = points[index]
  const left = index === 0 ? chart.left : (points[index - 1].x + point.x) / 2
  const right = index === points.length - 1 ? chartWidth - chart.right : (point.x + points[index + 1].x) / 2
  return { left, width: Math.max(right - left, 1) }
}

function SalesChart({ trends }) {
  const chartId = useId().replaceAll(':', '')
  const gradientId = `sales-gradient-${chartId}`
  const clipId = `sales-plot-${chartId}`
  const chartContainerRef = useRef(null)
  const [range, setRange] = useState('weekly')
  const [activeIndex, setActiveIndex] = useState(null)
  const [chartWidth, setChartWidth] = useState(760)
  const rangeOption = rangeOptions.find((option) => option.key === range)
  const data = useMemo(() => trends[range] || [], [range, trends])
  const model = useMemo(() => chartModel(data, chartWidth), [chartWidth, data])
  const hasRecordedSales = data.some((item) => Number(item.sales) > 0 || Number(item.transactions) > 0)
  const areaPath = model.points.length > 1 && hasRecordedSales
    ? `${model.path} L ${model.points.at(-1).x} ${model.bottom} L ${model.points[0].x} ${model.bottom} Z`
    : ''
  const activePoint = activeIndex === null ? null : model.points[activeIndex] || null
  const compactLayout = chartWidth < 480
  const labelStep = range === 'daily'
    ? (compactLayout ? 6 : 4)
    : range === 'monthly' ? (compactLayout ? 7 : 5) : (compactLayout ? 2 : 1)

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return undefined

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.max(Math.round(entries[0].contentRect.width), 280)
      setChartWidth((current) => current === nextWidth ? current : nextWidth)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  return (
    <article className="panel dashboard-sales-chart" ref={chartContainerRef}>
      <header className="dashboard-chart-header">
        <div>
          <h2><BarChart3 size={18} aria-hidden="true" /> {rangeOption.heading} Sales Performance</h2>
          <p>Sales Performance Overview</p>
        </div>
        <div className="dashboard-segments" aria-label="Sales chart period">
          {rangeOptions.map((option) => (
            <button
              className={range === option.key ? 'active' : ''}
              type="button"
              aria-pressed={range === option.key}
              key={option.key}
              onClick={() => {
                setRange(option.key)
                setActiveIndex(null)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>
      {!data.length ? (
        <EmptyState>No sales trend data available for this period.</EmptyState>
      ) : (
        <div className="dashboard-chart-scroll">
          <div className="chart-canvas">
            {activePoint && (
              <div
                className={`chart-tooltip ${activePoint.y < 104 ? 'below' : ''}`}
                style={{
                  left: `clamp(78px, ${(activePoint.x / chartWidth) * 100}%, calc(100% - 78px))`,
                  top: `${(activePoint.y / chart.height) * 100}%`,
                }}
              >
                <strong>{activePoint.label || 'Time unavailable'}</strong>
                <span>Sales: {peso.format(activePoint.sales)}</span>
                <small>
                  {activePoint.transactions} {activePoint.transactions === 1 ? 'transaction' : 'transactions'}
                </small>
              </div>
            )}
            <svg
              className="line-chart"
              viewBox={`0 0 ${chartWidth} ${chart.height}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`${rangeOption.label} sales performance`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1={chart.top} y2={model.bottom} gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
                <clipPath id={clipId}>
                  <rect
                    x={chart.left}
                    y={chart.top}
                    width={chartWidth - chart.left - chart.right}
                    height={model.bottom - chart.top}
                  />
                </clipPath>
              </defs>
              {areaPath && (
                <path
                  className="chart-fill"
                  d={areaPath}
                  clipPath={`url(#${clipId})`}
                  style={{ fill: `url(#${gradientId})` }}
                />
              )}
              {model.ticks.map((tick) => (
                <g key={tick.value}>
                  <line x1={chart.left} x2={chartWidth - chart.right} y1={tick.y} y2={tick.y} />
                  <text className="chart-axis-label" x={chart.left - 10} y={tick.y + 4} textAnchor="end">
                    {compactPeso.format(tick.value)}
                  </text>
                </g>
              ))}
              {model.points.length > 1 && <path className="chart-line" d={model.path} />}
              {model.points.map((point, index) => {
                const area = hitArea(model.points, index, chartWidth)
                const isActive = activeIndex === index

                return (
                  <g
                    className={`chart-point${isActive ? ' active' : ''}`}
                    key={`${point.label}-${index}`}
                    data-chart-y={point.y}
                    tabIndex="0"
                    role="img"
                    aria-label={`${point.label || 'Time unavailable'}: ${peso.format(point.sales)}, ${point.transactions} ${point.transactions === 1 ? 'transaction' : 'transactions'}`}
                    onPointerEnter={() => setActiveIndex(index)}
                    onPointerLeave={() => setActiveIndex(null)}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() => setActiveIndex(null)}
                  >
                    <rect
                      className="chart-hit-area"
                      x={area.left}
                      y={chart.top}
                      width={area.width}
                      height={model.bottom - chart.top}
                    />
                    {isActive && <line className="chart-hover-guide" x1={point.x} x2={point.x} y1={chart.top} y2={model.bottom} />}
                    {index % labelStep === 0 && (
                      <text className="chart-x-label" x={point.x} y={chart.height - 20} textAnchor="middle">
                        {point.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
        </div>
      )}
    </article>
  )
}

export default SalesChart
