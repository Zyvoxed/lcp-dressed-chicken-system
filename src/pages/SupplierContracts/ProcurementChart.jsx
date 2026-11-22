import { useMemo, useState } from 'react'
import {
  BarChart3,
  Filter,
  Layers,
  PackageCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import { peso } from '../../utils/currency.js'
import { formatQuantityWithUnit } from '../../utils/unitAwareMetrics.js'
import { aggregateProcurementMetrics } from '../../utils/procurementMetrics.js'

const SVG_HEIGHT = 290
const PAD_LEFT = 78
const PAD_RIGHT = 30
const PAD_TOP = 36
const PAD_BOTTOM = 58

function getYAxis(quantity) {
  const maximum = Math.max(Number(quantity) || 0, 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(maximum))) || 1
  const rawStep = Math.ceil(maximum / (4 * magnitude)) * magnitude
  const step = rawStep > 0 ? rawStep : Math.ceil(maximum / 4) || 1
  const max = step * 4 >= maximum ? step * 4 : Math.ceil(maximum * 1.15)
  return { max, ticks: [0, step, step * 2, step * 3, max] }
}

function ProcurementChart({ records = [], suppliers = [], loading, error }) {
  const [selectedSupplierId, setSelectedSupplierId] = useState('all')
  const [sortBy, setSortBy] = useState('volume')
  const [hoveredProduct, setHoveredProduct] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const filteredRecords = useMemo(() => (
    selectedSupplierId === 'all'
      ? records
      : records.filter((record) => String(record.supplier_id) === String(selectedSupplierId))
  ), [records, selectedSupplierId])

  const { productGroups, quantityByUnit, totalCost, deliveryBatches } = useMemo(() => {
    const metrics = aggregateProcurementMetrics(filteredRecords)
    const grouped = metrics.productsByUnit.map(({ unit, items }) => {
      const sortedItems = [...items].sort((left, right) => (
        sortBy === 'volume'
          ? right.quantity - left.quantity || left.product_name.localeCompare(right.product_name)
          : left.product_name.localeCompare(right.product_name)
      ))
      return { unit, items: sortedItems }
    })

    return {
      productGroups: grouped,
      quantityByUnit: metrics.quantitiesByUnit,
      totalCost: metrics.totalCost,
      deliveryBatches: metrics.deliveryBatches,
    }
  }, [filteredRecords, sortBy])

  const unitLeaders = productGroups.map(({ unit, items }) => {
    const leader = [...items].sort((left, right) => right.quantity - left.quantity || left.product_name.localeCompare(right.product_name))[0]
    return leader ? `${unit}: ${leader.product_name}` : ''
  }).filter(Boolean)
  const totalQuantityLabel = quantityByUnit
    .map(({ unit, quantity }) => formatQuantityWithUnit(quantity, unit, 1))
    .join(' · ')

  function handlePointerEnter(event, product) {
    const rect = event.currentTarget.getBoundingClientRect()
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top })
    setHoveredProduct(product)
  }

  return (
    <article className="panel supplier-procurement-panel">
      <div className="supplier-chart-header">
        <div className="supplier-panel-heading">
          <h2><BarChart3 size={18} aria-hidden="true" /><span>Stock Received by Product</span></h2>
          <p>Quantities are grouped by configured product unit and use independent chart scales.</p>
        </div>

        <div className="supplier-chart-controls">
          <label className="supplier-chart-filter">
            <Filter size={13} aria-hidden="true" />
            <span>Supplier</span>
            <select value={selectedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)} aria-label="Filter chart by supplier">
              <option value="all">All Active Suppliers ({suppliers.length})</option>
              {suppliers.map((supplier) => (
                <option key={supplier.supplier_id} value={String(supplier.supplier_id)}>{supplier.supplier_name}</option>
              ))}
            </select>
          </label>
          <div className="supplier-chart-sort" role="group" aria-label="Sort products within each unit">
            <button type="button" className={sortBy === 'volume' ? 'active' : ''} onClick={() => setSortBy('volume')}>Highest quantity per unit</button>
            <button type="button" className={sortBy === 'name' ? 'active' : ''} onClick={() => setSortBy('name')}>A–Z</button>
          </div>
        </div>
      </div>

      {loading && <PageSkeleton variant="supplier-chart" label="procurement chart" />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && !records.length && <EmptyState>No stock deliveries recorded yet.</EmptyState>}
      {!loading && !error && records.length > 0 && !productGroups.length && <EmptyState>No stock deliveries recorded for this supplier.</EmptyState>}

      {!loading && !error && productGroups.length > 0 && (
        <>
          <div className="supplier-chart-metrics">
            <div className="supplier-metric-chip">
              <span className="metric-chip-label"><PackageCheck size={13} aria-hidden="true" /> Total Stock Received</span>
              <strong className="metric-chip-value" title={totalQuantityLabel}>{totalQuantityLabel}</strong>
            </div>
            <div className="supplier-metric-chip">
              <span className="metric-chip-label"><Wallet size={13} aria-hidden="true" /> Total Procurement Spend</span>
              <strong className="metric-chip-value">{peso.format(totalCost)}</strong>
            </div>
            <div className="supplier-metric-chip">
              <span className="metric-chip-label"><TrendingUp size={13} aria-hidden="true" /> Top Product by Unit</span>
              <strong className="metric-chip-value" title={unitLeaders.join(' · ')}>{unitLeaders.join(' · ')}</strong>
            </div>
            <div className="supplier-metric-chip">
              <span className="metric-chip-label"><Layers size={13} aria-hidden="true" /> Confirmed Batches</span>
              <strong className="metric-chip-value">{deliveryBatches} deliveries</strong>
            </div>
          </div>

          <div className="supplier-unit-chart-groups">
            {productGroups.map(({ unit, items }, groupIndex) => {
              const baseWidth = Math.max(760, items.length * 90)
              const chartWidth = baseWidth - PAD_LEFT - PAD_RIGHT
              const chartHeight = SVG_HEIGHT - PAD_TOP - PAD_BOTTOM
              const { max: yMax, ticks } = getYAxis(Math.max(...items.map((item) => item.quantity)))
              const gradientId = `supplierBarGrad${groupIndex}`

              return (
                <section className="supplier-unit-chart-group" key={unit} aria-label={`Received quantities in ${unit}`}>
                  <h3>{unit}</h3>
                  <div className="supplier-chart-stage" tabIndex={0} role="region" aria-label={`Stock received bar chart in ${unit}`}>
                    <div className="supplier-chart-scroll-wrap">
                      <svg className="supplier-procurement-svg" viewBox={`0 0 ${baseWidth} ${SVG_HEIGHT}`} preserveAspectRatio="none" style={{ minWidth: `${baseWidth}px`, width: '100%', height: `${SVG_HEIGHT}px` }}>
                        <defs>
                          <linearGradient id={`${gradientId}Base`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8EB69B" stopOpacity="0.95" />
                            <stop offset="100%" stopColor="#235347" stopOpacity="0.95" />
                          </linearGradient>
                          <linearGradient id={`${gradientId}Hover`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#B3DAC0" stopOpacity="1" />
                            <stop offset="100%" stopColor="#2F6E5E" stopOpacity="1" />
                          </linearGradient>
                        </defs>
                        {ticks.map((tick, index) => {
                          const y = PAD_TOP + chartHeight - (tick / yMax) * chartHeight
                          return (
                            <g key={index} className="supplier-chart-tick-group">
                              <line x1={PAD_LEFT} y1={y} x2={baseWidth - PAD_RIGHT} y2={y} className="supplier-chart-gridline" />
                              <text x={PAD_LEFT - 10} y={y + 4} textAnchor="end" className="supplier-chart-y-label">
                                {formatQuantityWithUnit(tick, unit, 0)}
                              </text>
                            </g>
                          )
                        })}
                        <line x1={PAD_LEFT} y1={PAD_TOP + chartHeight} x2={baseWidth - PAD_RIGHT} y2={PAD_TOP + chartHeight} className="supplier-chart-baseline" />
                        {items.map((product, index) => {
                          const columnWidth = chartWidth / items.length
                          const barWidth = Math.min(48, columnWidth * 0.65)
                          const barX = PAD_LEFT + index * columnWidth + (columnWidth - barWidth) / 2
                          const barHeight = Math.max((product.quantity / yMax) * chartHeight, 6)
                          const barY = PAD_TOP + chartHeight - barHeight
                          const isHovered = hoveredProduct?.key === product.key
                          const label = formatQuantityWithUnit(product.quantity, unit, 1)

                          return (
                            <g
                              key={product.key}
                              className={`supplier-bar-group${isHovered ? ' is-hovered' : ''}`}
                              onPointerEnter={(event) => handlePointerEnter(event, product)}
                              onPointerLeave={() => setHoveredProduct(null)}
                              tabIndex={0}
                              role="graphics-symbol"
                              aria-label={`${product.product_name}: ${label} received`}
                            >
                              <rect x={barX} y={barY} width={barWidth} height={barHeight} rx="5" ry="5" fill={isHovered ? `url(#${gradientId}Hover)` : `url(#${gradientId}Base)`} className="supplier-chart-bar" />
                              <rect x={barX} y={barY} width={barWidth} height="3" rx="1.5" ry="1.5" fill="#DAF1DE" className="supplier-bar-cap" />
                              <text x={barX + barWidth / 2} y={barY - 8} textAnchor="middle" className="supplier-bar-value-label">
                                {formatQuantityWithUnit(product.quantity, unit, 1)}
                              </text>
                              <text x={barX + barWidth / 2} y={PAD_TOP + chartHeight + 18} textAnchor="middle" className="supplier-bar-x-label">
                                {product.product_name.length > 15 ? `${product.product_name.slice(0, 14)}…` : product.product_name}
                              </text>
                            </g>
                          )
                        })}
                      </svg>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>

          {hoveredProduct && (
            <div className="supplier-chart-tooltip" style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }} role="tooltip">
              <div className="tooltip-header"><strong>{hoveredProduct.product_name}</strong></div>
              <dl className="tooltip-details">
                <div><dt>Quantity Received</dt><dd className="highlight">{formatQuantityWithUnit(hoveredProduct.quantity, hoveredProduct.unit)}</dd></div>
                <div><dt>Total Recorded Cost</dt><dd>{peso.format(hoveredProduct.total_cost)}</dd></div>
                <div><dt>Average Cost / Unit</dt><dd>{peso.format(hoveredProduct.quantity > 0 ? hoveredProduct.total_cost / hoveredProduct.quantity : 0)} / {hoveredProduct.unit}</dd></div>
                <div><dt>Confirmed Deliveries</dt><dd>{hoveredProduct.deliveries} {hoveredProduct.deliveries === 1 ? 'batch' : 'batches'}</dd></div>
              </dl>
            </div>
          )}
        </>
      )}
    </article>
  )
}

export default ProcurementChart
