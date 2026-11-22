import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import EmptyState from '../Shared/EmptyState.jsx'
import { peso } from '../../utils/currency.js'
import { getProductSalesReport } from '../../services/reportService.js'
import { buildMonotonePath } from '../../utils/chartPaths.js'
import { getMonthlyIndexesForYear } from '../../utils/monthlyChartPeriods.js'
import {
  SALES_CHART_LAYOUT,
  SALES_CHART_STYLE,
} from '../../utils/salesChartPresentation.js'

const chartSize = SALES_CHART_LAYOUT
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const seriesColors = ['#235347', '#8EB69B', '#91ACB5', '#C6A76A', '#D98F7C']

function compactPeso(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function SalesByProductChart({ products = [] }) {
  const topProducts = useMemo(() => products.slice(0, 5), [products])
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
        const productIds = topProducts.map((product) => product.product_id)
        const report = await getProductSalesReport(productIds, null, { signal: controller.signal })
        const records = report.records || []
        const years = records.map((record) => Number(record.sale_year)).filter(Number.isInteger)
        const year = years.length ? Math.max(...years) : null
        if (isActive) setSelectedYear(year)

        if (year === null) {
          if (isActive) setSalesByProduct([])
          return
        }

        const monthIndexes = getMonthlyIndexesForYear(year)
        if (!monthIndexes.length) {
          if (isActive) setSalesByProduct([])
          return
        }

        const totals = new Map(topProducts.map((product) => [String(product.product_id), Array(monthIndexes.length).fill(0)]))
        for (const record of records) {
          if (Number(record.sale_year) !== year) continue
          const values = totals.get(String(record.product_id))
          const monthIndex = Number(record.sale_month) - 1
          const revenue = Number(record.sales_amount)
          if (values && monthIndex >= 0 && monthIndex < monthIndexes.length && Number.isFinite(revenue)) {
            values[monthIndex] += revenue
          }
        }
        if (isActive) setSalesByProduct(topProducts.map((product) => ({
          id: product.product_id,
          name: product.product_name,
          values: totals.get(String(product.product_id)),
          monthIndexes,
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
  }, [productKey, topProducts])

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
      const points = source.values.map((value, monthPosition) => ({
        x: source.values.length === 1
          ? chartSize.left + plotWidth / 2
          : chartSize.left + plotWidth * monthPosition / (source.values.length - 1),
        y: bottom - (value / maximum) * plotHeight,
        monthIndex: source.monthIndexes[monthPosition],
        value,
        name: source.name,
        color: seriesColors[seriesIndex],
      }))
      const path = buildMonotonePath(points)
      return {
        ...source,
        color: seriesColors[seriesIndex],
        points,
        path,
      }
    })
    return { bottom, ticks, series }
  }, [salesByProduct])

  function showPoint(point, event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Number.isFinite(event.clientX) && event.clientX ? event.clientX : bounds.left + bounds.width / 2
    const y = Number.isFinite(event.clientY) && event.clientY ? event.clientY : bounds.top
    const halfTooltipWidth = Math.min(150, (window.innerWidth - 24) / 2)
    setTooltip({
      point,
      x: Math.max(12 + halfTooltipWidth, Math.min(x, window.innerWidth - 12 - halfTooltipWidth)),
      y,
      above: y > 150,
    })
  }

  function hideHoverTooltip() {
    setTooltip(null)
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
                <svg className="dashboard-product-sales-chart sales-product-chart" viewBox={`0 0 ${chartSize.width} ${chartSize.height}`} preserveAspectRatio="none" role="img" aria-label={`Monthly product sales revenue for ${selectedYear}`}>
                  {model.ticks.map((tick) => (
                    <g key={tick.value}>
                      <line className="dashboard-product-sales-gridline sales-product-chart-gridline" x1={chartSize.left} x2={chartSize.width - chartSize.right} y1={tick.y} y2={tick.y} />
                      <text className="dashboard-product-sales-axis-label sales-product-chart-axis-label" x={chartSize.left - 9} y={tick.y + 4} textAnchor="end">{compactPeso(tick.value)}</text>
                    </g>
                  ))}
                  {model.series.map((series) => (
                    <g key={series.id}>
                      <path d={series.path} fill="none" stroke={series.color} strokeWidth={SALES_CHART_STYLE.lineWidth} strokeLinecap="round" strokeLinejoin="round" className="sales-product-chart-line" />
                      {series.points.map((point) => (
                        <circle
                          key={`${series.id}-${point.monthIndex}`}
                          cx={point.x}
                          cy={point.y}
                          r={SALES_CHART_STYLE.pointRadius}
                          fill={series.color}
                          stroke="var(--card-bg)"
                          strokeWidth={SALES_CHART_STYLE.markerStrokeWidth}
                          className="sales-product-chart-point"
                          onPointerEnter={(event) => showPoint(point, event)}
                          onPointerMove={(event) => showPoint(point, event)}
                          onPointerLeave={hideHoverTooltip}
                          aria-label={`${series.name}, ${monthNames[point.monthIndex]} ${selectedYear}, ${peso.format(point.value)} revenue`}
                        />
                      ))}
                    </g>
                  ))}
                  {model.series[0].monthIndexes.map((monthIndex, monthPosition) => (
                    <text key={monthIndex} className="dashboard-product-sales-axis-label sales-product-chart-axis-label" x={chartSize.left + (chartSize.width - chartSize.left - chartSize.right) * (model.series[0].monthIndexes.length === 1 ? 0.5 : monthPosition / (model.series[0].monthIndexes.length - 1))} y={chartSize.height - 18} textAnchor="middle">{months[monthIndex]}</text>
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
        </div>,
        document.body,
      )}
    </article>
  )
}

export default SalesByProductChart
