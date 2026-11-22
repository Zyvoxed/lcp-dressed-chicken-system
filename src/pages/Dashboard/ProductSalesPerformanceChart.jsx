import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Boxes,
  Check,
  ChevronDown,
  Search,
  TrendingUp,
  X,
} from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import { getProductSalesReport } from '../../services/reportService.js'
import { buildMonotonePath } from '../../utils/chartPaths.js'
import {
  getCurrentReportingYear,
  getMonthlyIndexesForYear,
} from '../../utils/monthlyChartPeriods.js'
import {
  SALES_CHART_LAYOUT,
  SALES_CHART_STYLE,
} from '../../utils/salesChartPresentation.js'

const PRODUCT_COLORS = [
  '#235347', // Forest Green
  '#8EB69B', // Soft Sage
  '#91ACB5', // Dusty Blue
  '#C6A76A', // Muted Gold
  '#D98F7C', // Soft Coral
]

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const chartSize = SALES_CHART_LAYOUT

function formatKgAxis(value) {
  const num = Number(value) || 0
  if (num >= 1000) {
    return `${(num / 1000).toLocaleString('en-PH', { maximumFractionDigits: 1 })}k kg`
  }
  return `${num.toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg`
}

function formatKgValue(value) {
  const num = Number(value) || 0
  return `${num.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kg`
}

function ProductSalesPerformanceChart({ products = [] }) {
  const [selectedProductIds, setSelectedProductIds] = useState(null)
  const activeProductIds = useMemo(
    () => selectedProductIds ?? products.slice(0, 5).map((product) => String(product.product_id)),
    [products, selectedProductIds],
  )

  const [periodMode, setPeriodMode] = useState('monthly')
  const [selectedYear, setSelectedYear] = useState(null)
  const [availableYears, setAvailableYears] = useState([])
  const [salesItems, setSalesItems] = useState(null)
  const [loadingSales, setLoadingSales] = useState(true)
  const [salesError, setSalesError] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [tooltip, setTooltip] = useState(null)

  const dropdownRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [dropdownOpen])

  // Load pre-aggregated sales quantities for the selected products.
  useEffect(() => {
    const controller = new AbortController()
    let isActive = true

    async function fetchSalesData() {
      setLoadingSales(true)
      setSalesError('')

      try {
        if (!activeProductIds.length) {
          if (isActive) {
            const currentYear = getCurrentReportingYear()
            setSalesItems([])
            setAvailableYears([currentYear])
            setSelectedYear(currentYear)
            setLoadingSales(false)
          }
          return
        }
        const report = await getProductSalesReport(activeProductIds.map(Number), null, { signal: controller.signal })
        const records = report?.records || []
        const extractedYears = Array.from(new Set(records.map((record) => Number(record.sale_year)).filter(Number.isInteger))).sort((a, b) => b - a)

        const defaultYear = extractedYears.length ? extractedYears[0] : getCurrentReportingYear()

        if (isActive) {
          setAvailableYears(extractedYears.length ? extractedYears : [defaultYear])
          setSelectedYear(defaultYear)
        }

        const collectedItems = records.map((record) => ({
          year: Number(record.sale_year),
          month: Number(record.sale_month) - 1,
          productId: String(record.product_id),
          quantity: Number(record.quantity_sold),
        })).filter((item) => Number.isFinite(item.quantity))

        if (isActive) {
          setSalesItems(collectedItems)
          setLoadingSales(false)
        }
      } catch (err) {
        if (isActive && err.name !== 'AbortError') {
          setSalesError(err.message || 'Unable to retrieve sales records.')
          setLoadingSales(false)
        }
      }
    }

    fetchSalesData()

    return () => {
      isActive = false
      controller.abort()
    }
  }, [activeProductIds])

  // Product map for quick lookup
  const productMap = useMemo(() => {
    const map = new Map()
    products.forEach((p) => map.set(String(p.product_id), p))
    return map
  }, [products])

  // Selected product objects
  const selectedProducts = useMemo(() => {
    return activeProductIds
      .map((id, index) => {
        const prod = productMap.get(String(id))
        if (!prod) return null
        return {
          ...prod,
          color: PRODUCT_COLORS[index % PRODUCT_COLORS.length],
        }
      })
      .filter(Boolean)
  }, [activeProductIds, productMap])

  // Filtered products for dropdown search
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) => p.product_name.toLowerCase().includes(q))
  }, [products, searchQuery])

  // Toggle selection for a product
  function handleToggleProduct(productId) {
    const idStr = String(productId)
    if (activeProductIds.includes(idStr)) {
      setSelectedProductIds(activeProductIds.filter((id) => id !== idStr))
    } else {
      if (activeProductIds.length >= 5) return // Max 5 limit reached
      setSelectedProductIds([...activeProductIds, idStr])
    }
  }

  // Remove a product from selection
  function handleRemoveProduct(productId) {
    setSelectedProductIds(activeProductIds.filter((id) => id !== String(productId)))
  }

  // Quick select Top 5
  function handleSelectTop5() {
    const top5 = products.slice(0, 5).map((p) => String(p.product_id))
    setSelectedProductIds(top5)
    setDropdownOpen(false)
  }

  // Clear selection
  function handleClearAll() {
    setSelectedProductIds([])
    setDropdownOpen(false)
  }

  // Build chart geometry, lines, and point markers
  const chartModel = useMemo(() => {
    if (!selectedProducts.length || !salesItems) return null

    const bottom = chartSize.height - chartSize.bottom
    const plotHeight = bottom - chartSize.top
    const plotWidth = chartSize.width - chartSize.left - chartSize.right

    let labels = []
    let fullLabels = []
    const monthlyIndexes = periodMode === 'monthly'
      ? getMonthlyIndexesForYear(selectedYear)
      : []
    if (periodMode === 'monthly' && monthlyIndexes.length === 0) return null

    if (periodMode === 'monthly') {
      labels = monthlyIndexes.map((monthIndex) => shortMonths[monthIndex])
      fullLabels = monthlyIndexes.map((monthIndex) => `${monthNames[monthIndex]} ${selectedYear}`)
    } else {
      const sortedYears = [...availableYears].sort((a, b) => a - b)
      labels = sortedYears.map(String)
      fullLabels = sortedYears.map((y) => `Year ${y}`)
    }

    const numPoints = labels.length

    // Aggregate quantities for each selected product
    const seriesList = selectedProducts.map((product) => {
      const values = Array(numPoints).fill(0)

      if (periodMode === 'monthly') {
        const targetYear = selectedYear
        for (const item of salesItems) {
          if (item.productId === String(product.product_id) && item.year === targetYear && item.month >= 0 && item.month < monthlyIndexes.length) {
            values[item.month] += item.quantity
          }
        }
      } else {
        const sortedYears = [...availableYears].sort((a, b) => a - b)
        for (const item of salesItems) {
          if (item.productId === String(product.product_id) && item.year) {
            const yrIndex = sortedYears.indexOf(item.year)
            if (yrIndex !== -1) {
              values[yrIndex] += item.quantity
            }
          }
        }
      }

      return {
        id: product.product_id,
        name: product.product_name,
        color: product.color,
        values,
      }
    })

    // Compute maximum value for Y-axis
    const maxVal = Math.max(...seriesList.flatMap((s) => s.values), 0)
    const maximum = maxVal > 0 ? Math.ceil(maxVal * 1.15) : 10

    // Y-axis ticks (5 evenly spaced steps: 0, 25%, 50%, 75%, 100%)
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const value = (maximum * i) / 4
      return {
        value,
        y: bottom - (plotHeight * i) / 4,
      }
    })

    // Compute straight-line coordinates and point data
    const seriesWithCoordinates = seriesList.map((series) => {
      const points = series.values.map((val, idx) => {
        const x = numPoints > 1 ? chartSize.left + (plotWidth * idx) / (numPoints - 1) : chartSize.left + plotWidth / 2
        const y = bottom - (val / maximum) * plotHeight
        return {
          x,
          y,
          value: val,
          label: labels[idx],
          fullPeriod: fullLabels[idx],
          name: series.name,
          color: series.color,
        }
      })

      // Smooth monotone curve (matches Dashboard line chart)
      const pathD = buildMonotonePath(points)

      return {
        ...series,
        points,
        pathD,
      }
    })

    // X-axis label coordinates
    const xLabels = labels.map((label, idx) => ({
      label,
      x: numPoints > 1 ? chartSize.left + (plotWidth * idx) / (numPoints - 1) : chartSize.left + plotWidth / 2,
      y: chartSize.height - 18,
    }))

    return {
      bottom,
      ticks,
      xLabels,
      series: seriesWithCoordinates,
    }
  }, [selectedProducts, salesItems, periodMode, selectedYear, availableYears])

  // Tooltip handler
  function showPointTooltip(point, event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Number.isFinite(event.clientX) && event.clientX ? event.clientX : bounds.left + bounds.width / 2
    const y = Number.isFinite(event.clientY) && event.clientY ? event.clientY : bounds.top
    const halfWidth = Math.min(140, (window.innerWidth - 24) / 2)

    setTooltip({
      point,
      x: Math.max(12 + halfWidth, Math.min(x, window.innerWidth - 12 - halfWidth)),
      y,
      above: y > 150,
    })
  }

  function hidePointTooltip() {
    setTooltip(null)
  }

  return (
    <article className="panel product-trends-chart-panel">
      {/* 1. Chart Header with Title and Date Period Filters */}
      <header className="product-trends-header">
        <div className="product-trends-title-group">
          <h2>
            <TrendingUp size={18} aria-hidden="true" />
            PRODUCT SALES TRENDS
          </h2>
          <p>Compare monthly sales performance across selected products.</p>
        </div>

        <div className="product-trends-filter-controls">
          {periodMode === 'monthly' && availableYears.length > 0 && (
            <div className="analytics-year-select-wrap">
              <select
                className="analytics-year-select"
                value={selectedYear || ''}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                aria-label="Select year for monthly trend"
              >
                {availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="analytics-period-toggle" role="group" aria-label="Time period selection">
            <button
              type="button"
              className={periodMode === 'monthly' ? 'active' : ''}
              onClick={() => setPeriodMode('monthly')}
            >
              Monthly
            </button>
            <button
              type="button"
              className={periodMode === 'yearly' ? 'active' : ''}
              onClick={() => setPeriodMode('yearly')}
            >
              Yearly
            </button>
          </div>
        </div>
      </header>

      {/* 2. Product Selector Control Bar & Dropdown */}
      <div className="product-selector-bar">
        <div className="product-selector-info">
          <span className="product-selector-helper">Select up to 5 products to compare.</span>
          <span className="product-selector-count">
            {activeProductIds.length} of 5 selected
          </span>
        </div>

        <div className="product-selector-actions" ref={dropdownRef}>
          <button
            type="button"
            className={`product-dropdown-trigger ${dropdownOpen ? 'open' : ''}`}
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-expanded={dropdownOpen}
            aria-haspopup="listbox"
          >
            <Search size={14} aria-hidden="true" />
            <span>Search & Choose Products</span>
            <ChevronDown size={14} className="dropdown-arrow" aria-hidden="true" />
          </button>

          {dropdownOpen && (
            <div className="product-dropdown-menu" role="dialog" aria-label="Product selector popup">
              <div className="product-dropdown-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search products by name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="product-search-clear"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="product-dropdown-list" role="listbox" aria-multiselectable="true">
                {!filteredProducts.length ? (
                  <p className="product-dropdown-empty">No products matching "{searchQuery}"</p>
                ) : (
                  filteredProducts.map((product) => {
                    const isSelected = activeProductIds.includes(String(product.product_id))
                    const isMaxReached = activeProductIds.length >= 5 && !isSelected
                    const selectedIdx = activeProductIds.indexOf(String(product.product_id))
                    const color = selectedIdx !== -1 ? PRODUCT_COLORS[selectedIdx % PRODUCT_COLORS.length] : null

                    return (
                      <button
                        key={product.product_id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        disabled={isMaxReached}
                        className={`product-dropdown-item ${isSelected ? 'selected' : ''} ${isMaxReached ? 'disabled' : ''}`}
                        onClick={() => handleToggleProduct(product.product_id)}
                      >
                        <span className={`product-checkbox ${isSelected ? 'checked' : ''}`}>
                          {isSelected && <Check size={12} strokeWidth={3} />}
                        </span>
                        {color && <span className="product-item-color-dot" style={{ backgroundColor: color }} />}
                        <span className="product-item-name">{product.product_name}</span>
                        {isMaxReached && <span className="product-item-limit-tag">Max 5</span>}
                      </button>
                    )
                  })
                )}
              </div>

              <div className="product-dropdown-footer">
                <button
                  type="button"
                  className="product-footer-btn"
                  onClick={handleSelectTop5}
                >
                  Top 5 Products
                </button>
                {activeProductIds.length > 0 && (
                  <button
                    type="button"
                    className="product-footer-btn clear"
                    onClick={handleClearAll}
                  >
                    Clear Selection
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Selected Products Chips Row */}
      {selectedProducts.length > 0 && (
        <div className="product-chips-row" aria-label="Currently selected products">
          {selectedProducts.map((product) => (
            <div
              key={product.product_id}
              className="product-chip"
              style={{ '--chip-accent': product.color }}
            >
              <span className="product-chip-dot" style={{ backgroundColor: product.color }} />
              <span className="product-chip-name">{product.product_name}</span>
              <button
                type="button"
                className="product-chip-remove"
                onClick={() => handleRemoveProduct(product.product_id)}
                aria-label={`Remove ${product.product_name} from chart`}
                title="Remove from comparison"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 4. Chart Legend */}
      {selectedProducts.length > 0 && (
        <div className="product-trends-legend" aria-label="Product color legend">
          {selectedProducts.map((product) => (
            <span key={product.product_id} className="legend-item">
              <i style={{ backgroundColor: product.color }} />
              <span>{product.product_name}</span>
            </span>
          ))}
        </div>
      )}

      {/* 5. Chart Area / States */}
      {salesError ? (
        <EmptyState>{salesError}</EmptyState>
      ) : loadingSales ? (
        <div className="product-trends-loading-state">
          <p>Loading product sales trend data…</p>
        </div>
      ) : !selectedProducts.length ? (
        <div className="product-trends-empty-state">
          <Boxes size={32} className="empty-icon" aria-hidden="true" />
          <h3>Select products to view their sales trends.</h3>
          <p>Choose up to 5 products from the selector above to compare their performance over time.</p>
          <button
            type="button"
            className="primary-action slim"
            onClick={handleSelectTop5}
          >
            Compare Top 5 Selling Products
          </button>
        </div>
      ) : !chartModel ? (
        <EmptyState>No sales records available for the selected period.</EmptyState>
      ) : (
        <div className="product-trends-canvas-wrapper">
          <svg
            className="product-trends-svg sales-product-chart"
            viewBox={`0 0 ${chartSize.width} ${chartSize.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Product sales volume trends (${periodMode})`}
          >
            {/* Subtle horizontal grid lines & Y-axis labels in KG */}
            {chartModel.ticks.map((tick) => (
              <g key={tick.value}>
                <line
                  className="product-trends-gridline sales-product-chart-gridline"
                  x1={chartSize.left}
                  x2={chartSize.width - chartSize.right}
                  y1={tick.y}
                  y2={tick.y}
                />
                <text
                  className="product-trends-axis-label sales-product-chart-axis-label"
                  x={chartSize.left - 8}
                  y={tick.y + 4}
                  textAnchor="end"
                >
                  {formatKgAxis(tick.value)}
                </text>
              </g>
            ))}

            {/* Smooth product lines and circular markers */}
            {chartModel.series.map((series) => (
              <g key={series.id} className="product-trends-series-group">
                <path
                  d={series.pathD}
                  fill="none"
                  stroke={series.color}
                  strokeWidth={SALES_CHART_STYLE.lineWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="product-trends-line sales-product-chart-line"
                />
                {series.points.map((point, ptIdx) => (
                  <circle
                    key={`${series.id}-${ptIdx}`}
                    cx={point.x}
                    cy={point.y}
                    r={SALES_CHART_STYLE.pointRadius}
                    fill={series.color}
                    stroke="var(--card-bg)"
                    strokeWidth={SALES_CHART_STYLE.markerStrokeWidth}
                    className="product-trends-point sales-product-chart-point"
                    aria-label={`${point.name}, ${point.fullPeriod}, ${formatKgValue(point.value)}`}
                    onPointerEnter={(e) => showPointTooltip(point, e)}
                    onPointerMove={(e) => showPointTooltip(point, e)}
                    onPointerLeave={hidePointTooltip}
                  />
                ))}
              </g>
            ))}

            {/* X-axis Month / Year Labels */}
            {chartModel.xLabels.map((item) => (
              <text
                key={item.label}
                className="product-trends-axis-label x-axis sales-product-chart-axis-label"
                x={item.x}
                y={item.y}
                textAnchor="middle"
              >
                {item.label}
              </text>
            ))}
          </svg>
        </div>
      )}

      {/* 6. Interactive Floating Tooltip */}
      {tooltip &&
        createPortal(
          <div
            className={`product-trends-tooltip sales-product-tooltip ${tooltip.above ? 'above' : 'below'}`}
            role="tooltip"
            style={{
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`,
              '--tooltip-accent': tooltip.point.color,
            }}
          >
            <div className="product-trends-tooltip-header">
              <span
                className="product-trends-tooltip-dot"
                style={{ backgroundColor: tooltip.point.color }}
              />
              <strong>{tooltip.point.name}</strong>
            </div>
            <div className="product-trends-tooltip-period">
              {tooltip.point.fullPeriod}
            </div>
            <div className="product-trends-tooltip-metric">
              Quantity Sold: <strong>{formatKgValue(tooltip.point.value)}</strong>
            </div>
          </div>,
          document.body,
        )}
    </article>
  )
}

export default ProductSalesPerformanceChart
