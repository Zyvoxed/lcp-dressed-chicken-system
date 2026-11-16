import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import EmptyState from '../Shared/EmptyState.jsx'
import { peso } from '../../utils/currency.js'
import { getSalesReport, getSalesReportDetail } from '../../services/reportService.js'
import { buildMonotonePath } from '../../utils/chartPaths.js'

const chartSize = { width: 680, height: 300, left: 64, right: 18, top: 20, bottom: 48 }
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const seriesColors = ['#235347', '#8EB69B', '#91ACB5', '#C6A76A', '#D98F7C']

function yearInManila(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return Number(new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric' }).format(date))
}

function compactPeso(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function SalesByProductChart({ products = [] }) {
  const topProducts = products.slice(0, 5)
  const productKey = topProducts.map((product) => product.product_id).join(',')
  const [salesByProduct, setSalesByProduct] = useState(null)
  const [selectedYear, setSelectedYear] = useState(null)
  const [tooltip, setTooltip] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let isActive = true

    async function loadProductSales() {
      setSalesByProduct(null)
      setSelectedYear(null)
      setError('')
      if (!topProducts.length) {
        setSalesByProduct([])
        return
      }

      try {
        const report = await getSalesReport({}, { signal: controller.signal })
        const records = report.records || []
        const years = records.map((record) => yearInManila(record.sale_date)).filter((year) => year !== null)
        const year = years.length ? Math.max(...years) : null
        if (isActive) setSelectedYear(year)

        if (year === null) {
          if (isActive) setSalesByProduct([])
          return
        }

        const yearRecords = records.filter((record) => yearInManila(record.sale_date) === year)
        const productIds = new Set(topProducts.map((product) => String(product.product_id)))
        const totals = new Map(topProducts.map((product) => [String(product.product_id), Array(12).fill(0)]))
        let nextRecord = 0
        const workerCount = Math.min(yearRecords.length, 6)

        async function loadWorker() {
          while (nextRecord < yearRecords.length) {
            const record = yearRecords[nextRecord]
            nextRecord += 1
            const detail = await getSalesReportDetail(record.sale_id, { signal: controller.signal })
            const saleDate = detail.sale?.sale_date || record.sale_date
            const saleMonth = Number(new Intl.DateTimeFormat('en-PH', {
              timeZone: 'Asia/Manila', month: 'numeric',
            }).format(new Date(saleDate))) - 1
            if (saleMonth < 0 || saleMonth > 11) continue

            for (const item of detail.items || []) {
              const productTotal = totals.get(String(item.product_id))
              const revenue = Number(item.subtotal)
              if (productIds.has(String(item.product_id)) && Number.isFinite(revenue)) {
                productTotal[saleMonth] += revenue
              }
            }
          }
        }

        await Promise.all(Array.from({ length: workerCount }, () => loadWorker()))
        if (isActive) setSalesByProduct(topProducts.map((product) => ({
          id: product.product_id,
          name: product.product_name,
          values: totals.get(String(product.product_id)),
        })))
      } catch (requestError) {
        if (isActive && requestError.name !== 'AbortError') setError(requestError.message)
      }
    }

    loadProductSales()
    return () => {
      isActive = false
      controller.abort()
    }
  }, [productKey])

  const model = useMemo(() => {
    if (!salesByProduct?.length) return null
    const bottom = chartSize.height - chartSize.bottom
    const plotHeight = bottom - chartSize.top
    const plotWidth = chartSize.width - chartSize.left - chartSize.right
    const maxValue = Math.max(...salesByProduct.flatMap((series) => series.values), 0)
    const maximum = maxValue > 0 ? maxValue * 1.12 : 1
    const ticks = Array.from({ length: 5 }, (_, index) => {
      const value = maximum * index / 4
      return { value, y: bottom - plotHeight * index / 4 }
    })
    const series = salesByProduct.map((source, seriesIndex) => {
      const points = source.values.map((value, monthIndex) => ({
        x: chartSize.left + plotWidth * monthIndex / 11,
        y: bottom - (value / maximum) * plotHeight,
        monthIndex,
        value,
        name: source.name,
        color: seriesColors[seriesIndex],
      }))
      return { ...source, color: seriesColors[seriesIndex], points, path: buildMonotonePath(points) }
    })
    return { bottom, ticks, series }
  }, [salesByProduct])

  function showPoint(point, event, pinned = false) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Number.isFinite(event.clientX) && event.clientX ? event.clientX : bounds.left + bounds.width / 2
    const y = Number.isFinite(event.clientY) && event.clientY ? event.clientY : bounds.top
    const halfTooltipWidth = Math.min(150, (window.innerWidth - 24) / 2)
    setTooltip({
      point,
      x: Math.max(12 + halfTooltipWidth, Math.min(x, window.innerWidth - 12 - halfTooltipWidth)),
      y,
      above: y > 150,
      pinned,
    })
  }

  function hideHoverTooltip() {
    setTooltip((current) => current?.pinned ? current : null)
  }

  function togglePinnedPoint(point, event) {
    setTooltip((current) => {
      if (current?.pinned && current.point.name === point.name && current.point.monthIndex === point.monthIndex) return null
      const bounds = event.currentTarget.getBoundingClientRect()
      const x = Number.isFinite(event.clientX) && event.clientX ? event.clientX : bounds.left + bounds.width / 2
      const y = Number.isFinite(event.clientY) && event.clientY ? event.clientY : bounds.top
      const halfTooltipWidth = Math.min(150, (window.innerWidth - 24) / 2)
      return {
        point,
        x: Math.max(12 + halfTooltipWidth, Math.min(x, window.innerWidth - 12 - halfTooltipWidth)),
        y,
        above: y > 150,
        pinned: true,
      }
    })
  }

  return (
    <article className="panel chart-panel dashboard-product-sales-panel">
      <header className="dashboard-product-sales-header">
        <div>
          <h2>Sales by Product</h2>
          <p>Monthly sales trends of the top 5 products</p>
        </div>
        {selectedYear && <span className="dashboard-badge">{selectedYear}</span>}
      </header>
      <div className="dashboard-product-sales-legend" aria-label="Top five products">
        {topProducts.map((product, index) => (
          <span key={product.product_id}>
            <i style={{ backgroundColor: seriesColors[index] }} />{product.product_name}
          </span>
        ))}
      </div>
      {error ? <EmptyState>{error}</EmptyState>
        : salesByProduct === null ? <p className="dashboard-product-sales-state">Loading product sales…</p>
          : !salesByProduct.length || !model ? <EmptyState>No product sales recorded.</EmptyState>
            : (
              <div className="dashboard-product-sales-canvas">
                <svg className="dashboard-product-sales-chart" viewBox={`0 0 ${chartSize.width} ${chartSize.height}`} preserveAspectRatio="none" role="img" aria-label={`Monthly product sales revenue for ${selectedYear}`}>
                  {model.ticks.map((tick) => (
                    <g key={tick.value}>
                      <line className="dashboard-product-sales-gridline" x1={chartSize.left} x2={chartSize.width - chartSize.right} y1={tick.y} y2={tick.y} />
                      <text className="dashboard-product-sales-axis-label" x={chartSize.left - 8} y={tick.y + 4} textAnchor="end">{compactPeso(tick.value)}</text>
                    </g>
                  ))}
                  {model.series.map((series) => (
                    <g key={series.id}>
                      <path d={series.path} fill="none" stroke={series.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      {series.points.map((point) => (
                        <circle
                          key={`${series.id}-${point.monthIndex}`}
                          cx={point.x}
                          cy={point.y}
                          r="4"
                          fill={series.color}
                          onPointerEnter={(event) => showPoint(point, event)}
                          onPointerMove={(event) => showPoint(point, event, tooltip?.pinned)}
                          onPointerLeave={hideHoverTooltip}
                          onClick={(event) => togglePinnedPoint(point, event)}
                          onFocus={(event) => showPoint(point, event)}
                          onBlur={hideHoverTooltip}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              togglePinnedPoint(point, event)
                            }
                          }}
                          tabIndex="0"
                          role="button"
                          aria-label={`${series.name}, ${monthNames[point.monthIndex]} ${selectedYear}, ${peso.format(point.value)} revenue`}
                        />
                      ))}
                    </g>
                  ))}
                  {months.map((month, index) => (
                    <text key={month} className="dashboard-product-sales-axis-label" x={chartSize.left + (chartSize.width - chartSize.left - chartSize.right) * index / 11} y={chartSize.height - 17} textAnchor="middle">{month}</text>
                  ))}
                </svg>
              </div>
            )}
      {tooltip && createPortal(
        <div
          className={`dashboard-product-sales-tooltip ${tooltip.above ? 'above' : 'below'}`}
          role="tooltip"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, '--tooltip-color': tooltip.point.color }}
        >
          <strong>{tooltip.point.name}</strong>
          <span>{monthNames[tooltip.point.monthIndex]} {selectedYear}: {peso.format(tooltip.point.value)}</span>
          {tooltip.pinned && <small>Click the point again to close</small>}
        </div>,
        document.body,
      )}
    </article>
  )
}

export default SalesByProductChart
