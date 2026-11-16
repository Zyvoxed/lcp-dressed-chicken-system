import { useMemo, useState } from 'react'
import {
  BarChart3,
  Building2,
  Filter,
  Layers,
  PackageCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import { peso } from '../../utils/currency.js'

function ProcurementChart({ records = [], suppliers = [], loading, error }) {
  const [selectedSupplierId, setSelectedSupplierId] = useState('all')
  const [sortBy, setSortBy] = useState('volume')
  const [hoveredProduct, setHoveredProduct] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // 1. Filter records by selected supplier
  const filteredRecords = useMemo(() => {
    if (selectedSupplierId === 'all') return records
    return records.filter((r) => String(r.supplier_id) === String(selectedSupplierId))
  }, [records, selectedSupplierId])

  // 2. Aggregate quantities and costs by product
  const { productList, totalVolume, totalCost, deliveryBatches } = useMemo(() => {
    const productMap = new Map()
    let volumeSum = 0
    let costSum = 0

    for (const record of filteredRecords) {
      const qty = Number(record.quantity_received) || 0
      const cost = Number(record.total_cost) || 0
      volumeSum += qty
      costSum += cost

      const key = record.product_name || 'Unknown Product'
      if (!productMap.has(key)) {
        productMap.set(key, {
          product_name: key,
          unit: record.unit || 'kg',
          quantity: 0,
          total_cost: 0,
          deliveries: 0,
        })
      }

      const item = productMap.get(key)
      item.quantity += qty
      item.total_cost += cost
      item.deliveries += 1
    }

    const list = Array.from(productMap.values()).map((item) => ({
      ...item,
      share: volumeSum > 0 ? (item.quantity / volumeSum) * 100 : 0,
      avgCost: item.quantity > 0 ? item.total_cost / item.quantity : 0,
    }))

    if (sortBy === 'volume') {
      list.sort((a, b) => b.quantity - a.quantity)
    } else {
      list.sort((a, b) => a.product_name.localeCompare(b.product_name))
    }

    return {
      productList: list,
      totalVolume: volumeSum,
      totalCost: costSum,
      deliveryBatches: filteredRecords.length,
    }
  }, [filteredRecords, sortBy])

  // Top received product
  const topProduct = productList.length > 0 ? [...productList].sort((a, b) => b.quantity - a.quantity)[0] : null

  // SVG Chart Dimensions
  const svgHeight = 290
  const padLeft = 65
  const padRight = 30
  const padTop = 36
  const padBottom = 58
  const baseWidth = Math.max(760, productList.length * 90)
  const chartW = baseWidth - padLeft - padRight
  const chartH = svgHeight - padTop - padBottom

  // Y-Scale calculation
  const maxQty = Math.max(...productList.map((p) => p.quantity), 10)
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxQty))) || 1
  const rawStep = Math.ceil(maxQty / (4 * magnitude)) * magnitude
  const yStep = rawStep > 0 ? rawStep : Math.ceil(maxQty / 4) || 10
  const yMax = yStep * 4 >= maxQty ? yStep * 4 : Math.ceil(maxQty * 1.15)
  const yTicks = [0, yStep, yStep * 2, yStep * 3, yMax]

  const handlePointerEnter = (event, product) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    })
    setHoveredProduct(product)
  }

  const handlePointerLeave = () => {
    setHoveredProduct(null)
  }

  return (
    <article className="panel supplier-procurement-panel">
      {/* Header & Controls */}
      <div className="supplier-chart-header">
        <div className="supplier-panel-heading">
          <h2>
            <BarChart3 size={18} aria-hidden="true" />
            <span>Stock Received by Product</span>
          </h2>
          <p>Confirmed delivery quantities received through Stock In across active product lines.</p>
        </div>

        <div className="supplier-chart-controls">
          <label className="supplier-chart-filter">
            <Filter size={13} aria-hidden="true" />
            <span>Supplier</span>
            <select
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              aria-label="Filter chart by supplier"
            >
              <option value="all">All Active Suppliers ({suppliers.length})</option>
              {suppliers.map((s) => (
                <option key={s.supplier_id} value={String(s.supplier_id)}>
                  {s.supplier_name}
                </option>
              ))}
            </select>
          </label>

          <div className="supplier-chart-sort" role="group" aria-label="Sort products by">
            <button
              type="button"
              className={sortBy === 'volume' ? 'active' : ''}
              onClick={() => setSortBy('volume')}
            >
              Highest Volume
            </button>
            <button
              type="button"
              className={sortBy === 'name' ? 'active' : ''}
              onClick={() => setSortBy('name')}
            >
              A–Z
            </button>
          </div>
        </div>
      </div>

      {loading && <PageSkeleton variant="supplier-chart" label="procurement chart" />}
      {!loading && error && <EmptyState>{error}</EmptyState>}

      {!loading && !error && !records.length && (
        <EmptyState>No stock deliveries recorded yet.</EmptyState>
      )}

      {!loading && !error && records.length > 0 && !productList.length && (
        <EmptyState>No stock deliveries recorded for this supplier.</EmptyState>
      )}

      {!loading && !error && productList.length > 0 && (
        <>
          {/* Summary Metric Chips */}
          <div className="supplier-chart-metrics">
            <div className="supplier-metric-chip">
              <span className="metric-chip-label">
                <PackageCheck size={13} aria-hidden="true" /> Total Stock Received
              </span>
              <strong className="metric-chip-value">
                {totalVolume.toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg
              </strong>
            </div>

            <div className="supplier-metric-chip">
              <span className="metric-chip-label">
                <Wallet size={13} aria-hidden="true" /> Total Procurement Spend
              </span>
              <strong className="metric-chip-value">{peso.format(totalCost)}</strong>
            </div>

            <div className="supplier-metric-chip">
              <span className="metric-chip-label">
                <TrendingUp size={13} aria-hidden="true" /> Top Product
              </span>
              <strong className="metric-chip-value" title={topProduct?.product_name}>
                {topProduct ? topProduct.product_name : '—'}
              </strong>
            </div>

            <div className="supplier-metric-chip">
              <span className="metric-chip-label">
                <Layers size={13} aria-hidden="true" /> Confirmed Batches
              </span>
              <strong className="metric-chip-value">{deliveryBatches} deliveries</strong>
            </div>
          </div>

          {/* SVG Bar Chart Canvas */}
          <div className="supplier-chart-stage" tabIndex={0} role="region" aria-label="Stock Received Bar Chart">
            <div className="supplier-chart-scroll-wrap">
              <svg
                className="supplier-procurement-svg"
                viewBox={`0 0 ${baseWidth} ${svgHeight}`}
                preserveAspectRatio="none"
                style={{ minWidth: `${baseWidth}px`, width: '100%', height: `${svgHeight}px` }}
              >
                <defs>
                  <linearGradient id="supplierBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8EB69B" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#235347" stopOpacity="0.95" />
                  </linearGradient>
                  <linearGradient id="supplierBarGradHover" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#B3DAC0" stopOpacity="1" />
                    <stop offset="100%" stopColor="#2F6E5E" stopOpacity="1" />
                  </linearGradient>
                </defs>

                {/* Horizontal Gridlines & Y-Axis Ticks */}
                {yTicks.map((tick, index) => {
                  const y = padTop + chartH - (tick / yMax) * chartH
                  return (
                    <g key={index} className="supplier-chart-tick-group">
                      <line
                        x1={padLeft}
                        y1={y}
                        x2={baseWidth - padRight}
                        y2={y}
                        className="supplier-chart-gridline"
                      />
                      <text
                        x={padLeft - 10}
                        y={y + 4}
                        textAnchor="end"
                        className="supplier-chart-y-label"
                      >
                        {Number(tick).toLocaleString('en-PH', { maximumFractionDigits: 0 })} kg
                      </text>
                    </g>
                  )
                })}

                {/* X-Axis Baseline */}
                <line
                  x1={padLeft}
                  y1={padTop + chartH}
                  x2={baseWidth - padRight}
                  y2={padTop + chartH}
                  className="supplier-chart-baseline"
                />

                {/* Data Bars */}
                {productList.map((product, index) => {
                  const colWidth = chartW / productList.length
                  const barWidth = Math.min(48, colWidth * 0.65)
                  const barX = padLeft + index * colWidth + (colWidth - barWidth) / 2
                  const barHeight = Math.max((product.quantity / yMax) * chartH, 6)
                  const barY = padTop + chartH - barHeight
                  const isHovered = hoveredProduct?.product_name === product.product_name

                  return (
                    <g
                      key={product.product_name}
                      className={`supplier-bar-group${isHovered ? ' is-hovered' : ''}`}
                      onPointerEnter={(e) => handlePointerEnter(e, product)}
                      onPointerLeave={handlePointerLeave}
                      tabIndex={0}
                      role="graphics-symbol"
                      aria-label={`${product.product_name}: ${product.quantity.toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg received`}
                    >
                      {/* Interactive Bar */}
                      <rect
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height={barHeight}
                        rx="5"
                        ry="5"
                        fill={isHovered ? 'url(#supplierBarGradHover)' : 'url(#supplierBarGrad)'}
                        className="supplier-chart-bar"
                      />

                      {/* Top Accent Rim */}
                      <rect
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height="3"
                        rx="1.5"
                        ry="1.5"
                        fill="#DAF1DE"
                        className="supplier-bar-cap"
                      />

                      {/* Top Value Label */}
                      <text
                        x={barX + barWidth / 2}
                        y={barY - 8}
                        textAnchor="middle"
                        className="supplier-bar-value-label"
                      >
                        {product.quantity >= 1000
                          ? `${(product.quantity / 1000).toFixed(1)}t`
                          : `${Number(product.quantity).toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg`}
                      </text>

                      {/* Bottom X-Axis Label */}
                      <text
                        x={barX + barWidth / 2}
                        y={padTop + chartH + 18}
                        textAnchor="middle"
                        className="supplier-bar-x-label"
                      >
                        {product.product_name.length > 15
                          ? `${product.product_name.slice(0, 14)}…`
                          : product.product_name}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>

          {/* Floating Tooltip */}
          {hoveredProduct && (
            <div
              className="supplier-chart-tooltip"
              style={{
                left: `${tooltipPos.x}px`,
                top: `${tooltipPos.y}px`,
              }}
              role="tooltip"
            >
              <div className="tooltip-header">
                <strong>{hoveredProduct.product_name}</strong>
              </div>
              <dl className="tooltip-details">
                <div>
                  <dt>Quantity Received</dt>
                  <dd className="highlight">
                    {hoveredProduct.quantity.toLocaleString('en-PH', { maximumFractionDigits: 3 })} {hoveredProduct.unit}
                  </dd>
                </div>
                <div>
                  <dt>Share of Procurement</dt>
                  <dd>{hoveredProduct.share.toFixed(1)}%</dd>
                </div>
                <div>
                  <dt>Total Recorded Cost</dt>
                  <dd>{peso.format(hoveredProduct.total_cost)}</dd>
                </div>
                <div>
                  <dt>Average Cost / Unit</dt>
                  <dd>{peso.format(hoveredProduct.avgCost)} / {hoveredProduct.unit}</dd>
                </div>
                <div>
                  <dt>Confirmed Deliveries</dt>
                  <dd>{hoveredProduct.deliveries} {hoveredProduct.deliveries === 1 ? 'batch' : 'batches'}</dd>
                </div>
              </dl>
            </div>
          )}
        </>
      )}
    </article>
  )
}

export default ProcurementChart
