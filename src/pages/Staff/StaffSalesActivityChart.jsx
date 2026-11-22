import { useEffect, useMemo, useRef, useState } from 'react'
import { getStaffSalesActivity } from '../../services/dashboardService.js'
import { buildMonotonePath } from '../../utils/chartPaths.js'

const chart = { height: 280, top: 26, bottom: 50 }
const dateLabel = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})
const tooltipDate = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

function dateFromKey(key) {
  return new Date(`${key}T00:00:00.000Z`)
}

function StaffSalesActivityChart() {
  const chartRef = useRef(null)
  const [chartWidth, setChartWidth] = useState(900)
  const [days, setDays] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(null)
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    const element = chartRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width)
      if (width > 0) setChartWidth((current) => current === width ? current : width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [loading, error, days])

  useEffect(() => {
    const controller = new AbortController()
    getStaffSalesActivity({ signal: controller.signal }).then((result) => {
      setDays(result)
      setActiveIndex(null)
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [retryVersion])

  const points = useMemo(() => {
    if (!days?.length) return []
    const maxValue = Math.max(0, ...days.map((day) => Number(day.transactions) || 0))
    const tickStep = Math.max(1, Math.ceil(maxValue / 4))
    const axisMax = Math.max(tickStep, Math.ceil(maxValue / tickStep) * tickStep)
    const left = chartWidth <= 520 ? 44 : 62
    const right = chartWidth <= 520 ? 12 : 24
    const plotWidth = chartWidth - left - right
    const plotHeight = chart.height - chart.top - chart.bottom
    const ticks = Array.from({ length: axisMax / tickStep + 1 }, (_, index) => index * tickStep)
    const values = days.map((day, index) => ({
      ...day,
      x: left + (plotWidth * index) / Math.max(days.length - 1, 1),
      y: chart.top + plotHeight * (1 - (Number(day.transactions) || 0) / axisMax),
    }))
    const baseline = chart.top + plotHeight
    const linePath = buildMonotonePath(values)
    const areaPath = values.length
      ? `${linePath} L ${values.at(-1).x} ${baseline} L ${values[0].x} ${baseline} Z`
      : ''
    return { values, ticks, axisMax, plotHeight, left, right, linePath, areaPath }
  }, [chartWidth, days])

  const hasTransactions = days?.some((day) => Number(day.transactions) > 0)
  const activePoint = points.values?.[activeIndex]

  function retrySalesActivity() {
    setLoading(true)
    setError('')
    setRetryVersion((value) => value + 1)
  }

  return (
    <article className="panel staff-sales-activity-panel" aria-labelledby="staff-sales-activity-title">
      <header className="staff-sales-activity-heading">
        <div>
          <h2 id="staff-sales-activity-title">Sales Activity</h2>
          <p>Number of sales transactions over the last 7 days.</p>
        </div>
      </header>
      {loading ? (
        <div className="staff-sales-activity-state" role="status">Loading sales activity…</div>
      ) : error ? (
        <div className="staff-sales-activity-state staff-sales-activity-error" role="alert">
          <span>Sales activity could not be loaded. {error}</span>
          <button className="secondary-action slim" type="button" onClick={retrySalesActivity}>Try again</button>
        </div>
      ) : !points.values?.length ? (
        <div className="staff-sales-activity-state">No sales activity is available for the last 7 days.</div>
      ) : (
        <div className="staff-sales-activity-chart-wrap">
          <div ref={chartRef} className="staff-sales-activity-chart" role="img" aria-label={`Sales transactions over the last seven days: ${points.values.map((day) => `${tooltipDate.format(dateFromKey(day.date))}, ${day.transactions} ${day.transactions === 1 ? 'transaction' : 'transactions'}`).join('; ')}`}>
            <svg viewBox={`0 0 ${chartWidth} ${chart.height}`} aria-hidden="true">
              <defs>
                <linearGradient id="staff-sales-activity-area-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.015" />
                </linearGradient>
              </defs>
              {points.ticks.map((tick) => {
                const y = chart.top + points.plotHeight * (1 - tick / points.axisMax)
                return (
                  <g key={tick}>
                    <line className="staff-sales-activity-gridline" x1={points.left} x2={chartWidth - points.right} y1={y} y2={y} />
                    <text className="staff-sales-activity-y-label" x={points.left - 12} y={y + 4} textAnchor="end">{tick}</text>
                  </g>
                )
              })}
              <path className="staff-sales-activity-area" d={points.areaPath} />
              <path className="staff-sales-activity-line" d={points.linePath} />
              {points.values.map((point, index) => (
                <g key={point.date}>
                  <text className="staff-sales-activity-x-label" x={point.x} y={chart.height - 15} textAnchor="middle">{dateLabel.format(dateFromKey(point.date))}</text>
                  <circle
                    className={`staff-sales-activity-point${activeIndex === index ? ' active' : ''}`}
                    cx={point.x}
                    cy={point.y}
                    r="5"
                    tabIndex="0"
                    aria-label={`${tooltipDate.format(dateFromKey(point.date))}: ${point.transactions} ${point.transactions === 1 ? 'transaction' : 'transactions'}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() => setActiveIndex(null)}
                  >
                    <title>{`${tooltipDate.format(dateFromKey(point.date))}: ${point.transactions} ${point.transactions === 1 ? 'transaction' : 'transactions'}`}</title>
                  </circle>
                </g>
              ))}
            </svg>
            {activePoint && (
              <div className={`staff-sales-activity-tooltip${activePoint.y < 82 ? ' below' : ''}`} style={{ left: `${Math.min(88, Math.max(12, (activePoint.x / chartWidth) * 100))}%`, top: `${(activePoint.y / chart.height) * 100}%` }} role="status">
                <strong>{tooltipDate.format(dateFromKey(activePoint.date))}</strong>
                <span>{activePoint.transactions} {activePoint.transactions === 1 ? 'transaction' : 'transactions'}</span>
              </div>
            )}
          </div>
          {!hasTransactions && <p className="staff-sales-activity-empty">No sales transactions were recorded in this period.</p>}
        </div>
      )}
    </article>
  )
}

export default StaffSalesActivityChart
