import { BarChart3, CalendarRange } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildMonotonePath } from '../../utils/chartPaths.js'
import { peso } from '../../utils/currency.js'
import EmptyState from '../Shared/EmptyState.jsx'
import { getSalesReport } from '../../services/reportService.js'

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
const customOption = { key: 'custom', label: 'Custom', heading: 'Custom', grouping: 'selected period' }

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

function manilaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1000) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function dateLabel(dateKey) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dateKey}T12:00:00+08:00`))
}

function customTrend(records, startDate, endDate) {
  const buckets = new Map()
  const singleDay = startDate === endDate
  const uniqueRecords = new Map(records.map((record) => [String(record.sale_id), record]))

  for (const sale of uniqueRecords.values()) {
    const saleDate = new Date(sale.sale_date)
    if (Number.isNaN(saleDate.getTime())) continue
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(saleDate)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const key = singleDay
      ? `${values.year}-${values.month}-${values.day}-${values.hour}`
      : `${values.year}-${values.month}-${values.day}`
    const bucket = buckets.get(key) || { salesCents: 0, transactions: 0 }
    bucket.salesCents += Math.round(Number(sale.total_amount) * 100)
    bucket.transactions += 1
    buckets.set(key, bucket)
  }

  if (singleDay) {
    return Array.from({ length: 24 }, (_, hour) => {
      const bucket = buckets.get(`${startDate}-${String(hour).padStart(2, '0')}`)
      return {
        label: `${String(hour).padStart(2, '0')}:00`,
        sales: (bucket?.salesCents || 0) / 100,
        transactions: bucket?.transactions || 0,
      }
    })
  }

  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const series = []
  for (let cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10)
    const bucket = buckets.get(key)
    series.push({
      label: dateLabel(key),
      sales: (bucket?.salesCents || 0) / 100,
      transactions: bucket?.transactions || 0,
    })
  }
  return series
}

function SalesChart({ trends }) {
  const chartId = useId().replaceAll(':', '')
  const gradientId = `sales-gradient-${chartId}`
  const clipId = `sales-plot-${chartId}`
  const chartContainerRef = useRef(null)
  const customButtonRef = useRef(null)
  const popoverRef = useRef(null)
  const requestControllerRef = useRef(null)
  const [range, setRange] = useState('weekly')
  const [activeIndex, setActiveIndex] = useState(null)
  const [chartWidth, setChartWidth] = useState(760)
  const [customData, setCustomData] = useState(null)
  const [customDates, setCustomDates] = useState(() => {
    const today = manilaDateString()
    return { start_date: today, end_date: today }
  })
  const [customRange, setCustomRange] = useState(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState(null)
  const [customLoading, setCustomLoading] = useState(false)
  const [customError, setCustomError] = useState('')
  const rangeOption = rangeOptions.find((option) => option.key === range) || customOption
  const data = useMemo(
    () => range === 'custom' ? customData || [] : trends[range] || [],
    [customData, range, trends],
  )
  const model = useMemo(() => chartModel(data, chartWidth), [chartWidth, data])
  const hasRecordedSales = data.some((item) => Number(item.sales) > 0 || Number(item.transactions) > 0)
  const customHasNoSales = range === 'custom' && customData && !hasRecordedSales
  const areaPath = model.points.length > 1 && hasRecordedSales
    ? `${model.path} L ${model.points.at(-1).x} ${model.bottom} L ${model.points[0].x} ${model.bottom} Z`
    : ''
  const activePoint = activeIndex === null ? null : model.points[activeIndex] || null
  const compactLayout = chartWidth < 480
  const labelStep = range === 'custom'
    ? Math.max(Math.ceil(data.length / (compactLayout ? 5 : 9)), 1)
    : range === 'daily'
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

  useLayoutEffect(() => {
    if (!popoverOpen || !customButtonRef.current || !popoverRef.current) return undefined

    function positionPopover() {
      const button = customButtonRef.current?.getBoundingClientRect()
      const panel = popoverRef.current?.getBoundingClientRect()
      if (!button || !panel) return

      const margin = 12
      const gap = 8
      const left = Math.min(
        Math.max(button.right - panel.width, margin),
        window.innerWidth - panel.width - margin,
      )
      const below = button.bottom + panel.height + gap <= window.innerHeight - margin
      const top = below
        ? button.bottom + gap
        : Math.max(margin, button.top - panel.height - gap)
      setPopoverPosition({ left, top })
    }

    positionPopover()
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)
    return () => {
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
    }
  }, [popoverOpen, customError, customLoading])

  useEffect(() => {
    if (!popoverOpen) return undefined

    function dismiss(event) {
      if (event.key === 'Escape') {
        requestControllerRef.current?.abort()
        setCustomLoading(false)
        setPopoverOpen(false)
        setCustomError('')
      }
    }

    function dismissOutside(event) {
      if (
        !popoverRef.current?.contains(event.target)
        && !customButtonRef.current?.contains(event.target)
      ) {
        requestControllerRef.current?.abort()
        setCustomLoading(false)
        setPopoverOpen(false)
        setCustomError('')
      }
    }

    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', dismissOutside)
    return () => {
      document.removeEventListener('keydown', dismiss)
      document.removeEventListener('pointerdown', dismissOutside)
    }
  }, [popoverOpen])

  useEffect(() => () => requestControllerRef.current?.abort(), [])

  async function applyCustomRange(event) {
    event.preventDefault()
    setCustomError('')
    const { start_date: startDate, end_date: endDate } = customDates
    if (!validDate(startDate) || !validDate(endDate)) {
      setCustomError('Select valid start and end dates.')
      return
    }
    if (startDate > endDate) {
      setCustomError('Start Date cannot be later than End Date.')
      return
    }

    requestControllerRef.current?.abort()
    const controller = new AbortController()
    requestControllerRef.current = controller
    setCustomLoading(true)
    try {
      const report = await getSalesReport(
        { start_date: startDate, end_date: endDate },
        { signal: controller.signal },
      )
      if (controller.signal.aborted) return
      const records = (report.records || []).filter(
        (record) => record.payment_type === 'Cash' || record.payment_type === 'Credit',
      )
      setCustomData(customTrend(records, startDate, endDate))
      setCustomRange({ start_date: startDate, end_date: endDate })
      setRange('custom')
      setActiveIndex(null)
      setPopoverOpen(false)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') setCustomError(requestError.message)
    } finally {
      if (!controller.signal.aborted) setCustomLoading(false)
    }
  }

  return (
    <article className="panel dashboard-sales-chart" ref={chartContainerRef}>
      <header className="dashboard-chart-header">
        <div>
          <h2><BarChart3 size={18} aria-hidden="true" /> {rangeOption.heading} Sales Performance</h2>
          <p>
            {range === 'custom' && customRange
              ? `${customRange.start_date} to ${customRange.end_date}`
              : 'Sales Performance Overview'}
          </p>
        </div>
        <div className="dashboard-segments" aria-label="Sales chart period">
          {rangeOptions.map((option) => (
            <button
              className={range === option.key ? 'active' : ''}
              type="button"
              aria-pressed={range === option.key}
              key={option.key}
              onClick={() => {
                requestControllerRef.current?.abort()
                setCustomLoading(false)
                setRange(option.key)
                setActiveIndex(null)
              }}
            >
              {option.label}
            </button>
          ))}
          <button
            ref={customButtonRef}
            className={range === 'custom' ? 'active' : ''}
            type="button"
            aria-pressed={range === 'custom'}
            aria-expanded={popoverOpen}
            onClick={() => {
              const today = manilaDateString()
              setCustomDates(customRange || { start_date: today, end_date: today })
              setCustomError('')
              setPopoverOpen((open) => !open)
            }}
          >
            <CalendarRange size={13} aria-hidden="true" />
            Custom
          </button>
        </div>
      </header>
      {popoverOpen && (
        <form
          ref={popoverRef}
          className="panel"
          onSubmit={applyCustomRange}
          style={{
            position: 'fixed',
            left: popoverPosition?.left ?? 12,
            top: popoverPosition?.top ?? 12,
            zIndex: 50,
            width: 'min(320px, calc(100vw - 24px))',
            maxHeight: 'calc(100vh - 24px)',
            overflowY: 'auto',
            display: 'grid',
            gap: 12,
            padding: 16,
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--card-bg)',
            boxShadow: 'var(--shadow)',
          }}
          aria-label="Custom sales date range"
        >
          <label>
            Start Date
            <input
              type="date"
              value={customDates.start_date}
              disabled={customLoading}
              onChange={(event) => setCustomDates((current) => ({ ...current, start_date: event.target.value }))}
            />
          </label>
          <label>
            End Date
            <input
              type="date"
              value={customDates.end_date}
              disabled={customLoading}
              onChange={(event) => setCustomDates((current) => ({ ...current, end_date: event.target.value }))}
            />
          </label>
          {customError && <p className="report-inline-error" role="alert">{customError}</p>}
          {customLoading && <span role="status">Loading sales data…</span>}
          <div className="dashboard-segments" style={{ justifyContent: 'flex-end', gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                requestControllerRef.current?.abort()
                setCustomLoading(false)
                setPopoverOpen(false)
              }}
            >
              Cancel
            </button>
            <button className="active" type="submit" disabled={customLoading}>
              {customLoading ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </form>
      )}
      {!data.length || customHasNoSales ? (
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
