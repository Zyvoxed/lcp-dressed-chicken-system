import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BarChart3 } from 'lucide-react'
import { peso } from '../../utils/currency.js'
import { toTransactionCents } from '../../utils/transactionMoney.js'
import { buildMonotonePath } from '../../utils/chartPaths.js'
import EmptyState from '../Shared/EmptyState.jsx'
import { getSalesReport } from '../../services/reportService.js'

const chart = { height: 310, left: 72, right: 18, top: 24, bottom: 48 }
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const compactPeso = new Intl.NumberFormat('en-PH', {
  style: 'currency', currency: 'PHP', notation: 'compact', maximumFractionDigits: 1,
})

function areaPath(points, baseline, linePath) {
  if (!points.length) return ''
  return `${linePath} L ${points.at(-1).x} ${baseline} L ${points[0].x} ${baseline} Z`
}

function saleYear(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Number(new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric' }).format(date))
}

function saleMonth(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Number(new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'numeric' }).format(date)) - 1
}

function normalizeSales(records) {
  const seenSaleIds = new Set()
  const sales = []

  for (const record of records) {
    const saleId = String(record.sale_id ?? '')
    const year = saleYear(record.sale_date)
    const month = saleMonth(record.sale_date)
    if (!saleId || seenSaleIds.has(saleId) || year === null || month === null) continue

    let revenueCents
    try {
      revenueCents = toTransactionCents(record.total_amount)
    } catch {
      continue
    }

    seenSaleIds.add(saleId)
    sales.push({ saleId, year, month, revenueCents })
  }

  return sales
}

function formatPesoCents(cents) {
  const value = BigInt(cents)
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')
  const parts = peso.formatToParts(negative ? -whole : whole)
  return parts.map((part) => part.type === 'fraction' ? fraction : part.value).join('')
}

function niceMaximum(maxValue) {
  if (!(maxValue > 0)) return 1
  const target = maxValue * 1.1
  const magnitude = 10 ** Math.floor(Math.log10(target / 4))
  const step = Math.max(magnitude, 0.01)
  return Math.ceil(target / step) * step
}

function SalesChart() {
  const chartContainerRef = useRef(null)
  const tooltipRef = useRef(null)
  const pointerRef = useRef(null)
  const [period, setPeriod] = useState('monthly')
  const [selectedYear, setSelectedYear] = useState(null)
  const [chartWidth, setChartWidth] = useState(700)
  const [activeIndex, setActiveIndex] = useState(null)
  const [sales, setSales] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    getSalesReport({}, { signal: controller.signal }).then((report) => {
      const normalizedSales = normalizeSales(report.records || [])
      setSales(normalizedSales)
      const availableYears = normalizedSales.map((sale) => sale.year)
      setSelectedYear(availableYears.length ? Math.max(...availableYears) : null)
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return undefined
    const observer = new ResizeObserver((entries) => {
      const width = Math.max(Math.round(entries[0].contentRect.width), 280)
      setChartWidth((current) => current === width ? current : width)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const years = useMemo(() => [...new Set((sales || []).map((sale) => sale.year))].sort((a, b) => a - b), [sales])

  const periodData = useMemo(() => {
    if (!sales) return null
    const buckets = period === 'monthly' ? months.map((_, index) => index) : years
    const totals = new Map(buckets.map((bucket) => [bucket, 0n]))

    for (const sale of sales) {
      if (period === 'monthly' && sale.year !== selectedYear) continue
      const bucket = period === 'monthly' ? sale.month : sale.year
      totals.set(bucket, (totals.get(bucket) || 0n) + sale.revenueCents)
    }

    return { buckets, values: buckets.map((bucket) => totals.get(bucket) || 0n) }
  }, [period, sales, selectedYear, years])

  const model = useMemo(() => {
    if (!periodData) return null
    const bottom = chart.height - chart.bottom
    const plotWidth = chartWidth - chart.left - chart.right
    const plotHeight = bottom - chart.top
    const values = periodData.values.map((value) => Number(value) / 100)
    const maximum = niceMaximum(Math.max(...values, 0))
    const points = periodData.buckets.map((bucket, index) => ({
      bucket,
      value: periodData.values[index],
      x: periodData.buckets.length === 1
        ? chart.left + plotWidth / 2
        : chart.left + plotWidth * index / (periodData.buckets.length - 1),
      y: bottom - (values[index] / maximum) * plotHeight,
    }))
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
      value: maximum * fraction,
      y: bottom - plotHeight * fraction,
    }))

    const path = buildMonotonePath(points)
    return { bottom, points, ticks, path, area: areaPath(points, bottom, path) }
  }, [chartWidth, periodData])

  const positionTooltip = useCallback((x, y) => {
    pointerRef.current = { x, y }
    const tooltip = tooltipRef.current
    if (!tooltip) return

    const halfTooltipWidth = Math.min(150, (window.innerWidth - 24) / 2)
    const left = Math.max(12 + halfTooltipWidth, Math.min(x, window.innerWidth - 12 - halfTooltipWidth))
    tooltip.style.left = `${left}px`
    tooltip.style.top = `${y}px`
    tooltip.classList.toggle('above', y > 150)
    tooltip.classList.toggle('below', y <= 150)
  }, [])

  function showPoint(index, event) {
    setActiveIndex(index)
    positionTooltip(event.clientX, event.clientY)
  }

  function hideTooltip() {
    setActiveIndex(null)
    pointerRef.current = null
  }

  useLayoutEffect(() => {
    if (activeIndex === null || !pointerRef.current) return
    positionTooltip(pointerRef.current.x, pointerRef.current.y)
  }, [activeIndex, positionTooltip])

  useEffect(() => {
    function repositionTooltip() {
      if (pointerRef.current) positionTooltip(pointerRef.current.x, pointerRef.current.y)
    }
    window.addEventListener('resize', repositionTooltip)
    return () => window.removeEventListener('resize', repositionTooltip)
  }, [positionTooltip])

  const activePoint = activeIndex === null ? null : model?.points[activeIndex]
  const activePeriod = activePoint
    ? period === 'monthly' ? `${monthNames[activePoint.bucket]} ${selectedYear}` : String(activePoint.bucket)
    : ''
  const yearLabelStep = Math.max(Math.ceil((periodData?.buckets.length || 1) / (chartWidth < 500 ? 4 : 8)), 1)
  const hasSales = Boolean(periodData?.values.some((value) => value > 0n))
  const emptyMessage = period === 'monthly'
    ? `No sales revenue recorded for ${selectedYear ?? 'the selected year'}.`
    : 'No recorded sales revenue is available.'

  return (
    <article className="panel dashboard-sales-chart" ref={chartContainerRef}>
      <header className="dashboard-chart-header">
        <div>
          <h2><BarChart3 size={18} aria-hidden="true" /> Sales Revenue Overview</h2>
          <p>{period === 'monthly' ? `Monthly business revenue for ${selectedYear ?? 'selected year'}` : 'Annual business revenue across recorded sales'}</p>
        </div>
        <div className="sales-chart-filters">
          {period === 'monthly' && years.length > 0 && (
            <label className="sales-chart-year">Year
              <select value={selectedYear ?? ''} onChange={(event) => { setSelectedYear(Number(event.target.value)); hideTooltip() }}>
                {[...years].reverse().map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
          )}
          <div className="dashboard-segments" role="group" aria-label="Sales chart period">
            {['monthly', 'yearly'].map((option) => (
              <button
                key={option}
                className={period === option ? 'active' : ''}
                type="button"
                aria-pressed={period === option}
                onClick={() => { setPeriod(option); hideTooltip() }}
              >
                {option === 'monthly' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>
      </header>
      {loading ? <p className="sales-chart-state" role="status">Loading sales records…</p>
        : error ? <EmptyState>{error}</EmptyState>
          : !periodData?.buckets.length || !hasSales ? <EmptyState>{emptyMessage}</EmptyState>
            : (
              <div className="dashboard-chart-scroll">
                <div className="chart-canvas sales-overview-canvas">
                  <svg className="line-chart" viewBox={`0 0 ${chartWidth} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label={`${period} total sales revenue overview`}>
                    <defs>
                      <linearGradient id="sales-revenue-area-gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.015" />
                      </linearGradient>
                    </defs>
                    {model.ticks.map((tick) => (
                      <g key={tick.value}>
                        <line className="sales-overview-gridline" x1={chart.left} x2={chartWidth - chart.right} y1={tick.y} y2={tick.y} />
                        <text className="chart-axis-label" x={chart.left - 9} y={tick.y + 4} textAnchor="end">{compactPeso.format(tick.value)}</text>
                      </g>
                    ))}
                    <path className="sales-overview-area" d={model.area} />
                    <path className="chart-line sales-overview-line" d={model.path} />
                    {model.points.map((point, index) => (
                      <circle
                        key={point.bucket}
                        className="sales-overview-point"
                        cx={point.x}
                        cy={point.y}
                        r="4.5"
                        onPointerEnter={(event) => showPoint(index, event)}
                        onPointerMove={(event) => showPoint(index, event)}
                        onPointerLeave={hideTooltip}
                        aria-label={`${period === 'monthly' ? `${monthNames[point.bucket]} ${selectedYear}` : point.bucket}: ${formatPesoCents(point.value)}`}
                      />
                    ))}
                    {model.points.map((point, index) => (
                      period === 'monthly' || index === 0 || index === model.points.length - 1 || index % yearLabelStep === 0
                        ? <text key={`label-${point.bucket}`} className="chart-x-label" x={point.x} y={chart.height - 18} textAnchor="middle">
                          {period === 'monthly' ? months[point.bucket] : point.bucket}
                        </text>
                        : null
                    ))}
                  </svg>
                </div>
              </div>
            )}
      {activePoint && createPortal(
        <div
          ref={tooltipRef}
          className={`dashboard-product-sales-tooltip ${pointerRef.current?.y > 150 ? 'above' : 'below'}`}
          role="tooltip"
          style={{ '--tooltip-color': 'var(--primary)' }}
        >
          <strong>{activePeriod}</strong>
          <span>Total sales revenue: {formatPesoCents(activePoint.value)}</span>
        </div>,
        document.body,
      )}
    </article>
  )
}

export default SalesChart
