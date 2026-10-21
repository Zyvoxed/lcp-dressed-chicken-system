import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Layers3, PackageCheck, PackageX, TriangleAlert } from 'lucide-react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import StatCard from '../Shared/StatCard.jsx'
import { getInventoryReport, logReportExport } from '../../services/reportService.js'
import { exportCsv, manilaDateStamp } from '../../utils/csvExport.js'
import { peso } from '../../utils/currency.js'

const donutRadius = 70
const donutCircumference = 2 * Math.PI * donutRadius

function safeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function formatQuantity(value) {
  return safeNumber(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function productColor(product) {
  const numericId = Number(product.product_id)
  const seed = Number.isInteger(numericId)
    ? numericId
    : [...String(product.product_name)].reduce((total, character) => total + character.charCodeAt(0), 0)
  const hue = Math.round((seed * 137.508) % 360)
  const saturation = 52 + (seed % 3) * 6
  const lightness = 43 + (seed % 4) * 3
  return `hsl(${hue} ${saturation}% ${lightness}%)`
}

function InventoryValuation() {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hoveredProductId, setHoveredProductId] = useState(null)
  const [selectedProductId, setSelectedProductId] = useState(null)

  async function retryReport() {
    setLoading(true)
    setError('')
    try {
      setReport(await getInventoryReport())
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    getInventoryReport({ signal: controller.signal })
      .then(setReport)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const chartProducts = useMemo(() => {
    if (!report) return []
    return report.records
      .map((product) => ({
        ...product,
        chartValue: Math.max(safeNumber(product.inventory_cost_value), 0),
        chartColor: productColor(product),
      }))
      .filter((product) => product.chartValue > 0)
      .sort((left, right) => Number(left.product_id) - Number(right.product_id))
  }, [report])

  const chartTotal = useMemo(
    () => chartProducts.reduce((total, product) => total + product.chartValue, 0),
    [chartProducts],
  )
  const activeProductId = hoveredProductId ?? selectedProductId
  const activeProduct = chartProducts.find((product) => product.product_id === activeProductId) ?? null

  async function download() {
    try {
      await logReportExport('Inventory Valuation')
    } catch (logError) {
      console.error(logError.message)
    }
    exportCsv(
      `inventory-report-${manilaDateStamp()}.csv`,
      ['Product', 'Category', 'Unit', 'Stock Quantity', 'Stock Cost Value', 'Estimated Sales Value', 'Status'],
      report.records.map((product) => [
        product.product_name,
        product.category,
        product.unit,
        product.stock_quantity,
        product.inventory_cost_value,
        product.estimated_sales_value,
        product.status,
      ]),
    )
  }

  function toggleSelectedProduct(productId) {
    setHoveredProductId(null)
    setSelectedProductId((current) => current === productId ? null : productId)
  }

  if (loading && !report) {
    return <div className="panel report-state-panel inventory-valuation-state"><LoadingSpinner /></div>
  }
  if (error && !report) {
    return (
      <div className="panel report-state-panel inventory-valuation-state">
        <EmptyState>{error}</EmptyState>
        <button className="secondary-action slim" type="button" onClick={retryReport}>Try Again</button>
      </div>
    )
  }
  if (!report) return <div className="panel report-state-panel"><EmptyState>No inventory report data found.</EmptyState></div>

  const totalCost = safeNumber(report.summary.total_inventory_cost_value)
  const totalSalesValue = safeNumber(report.summary.estimated_total_sales_value)
  const totalsReconcile = Math.abs(chartTotal - totalCost) < 0.005
  const segments = chartProducts.map((product, index) => {
    const share = chartTotal > 0 ? product.chartValue / chartTotal : 0
    const priorValue = chartProducts
      .slice(0, index)
      .reduce((total, priorProduct) => total + priorProduct.chartValue, 0)
    return {
      ...product,
      share,
      dashLength: share * donutCircumference,
      dashOffset: chartTotal > 0 ? -(priorValue / chartTotal) * donutCircumference : 0,
    }
  })

  return (
    <div className="report-tab-content inventory-valuation-tab">
      <div className="stats-grid report-stats report-inventory-stats">
        <StatCard icon={PackageCheck} label="Active Products" value={safeNumber(report.summary.total_products).toLocaleString('en-PH')} helper="Active catalog items" />
        <StatCard icon={Layers3} label="FIFO Stock Cost" value={peso.format(totalCost)} helper="Remaining batch cost" />
        <StatCard icon={BadgeDollarSign} label="Estimated Sales Value" value={peso.format(totalSalesValue)} helper="At current selling prices" />
        <StatCard icon={TriangleAlert} label="Low Stock" value={safeNumber(report.summary.low_stock_count).toLocaleString('en-PH')} helper="At or below reorder level" />
        <StatCard icon={PackageX} label="Out of Stock" value={safeNumber(report.summary.out_of_stock_count).toLocaleString('en-PH')} helper="No remaining stock" />
      </div>

      <section className="report-layout inventory-valuation-layout">
        <article className="panel table-panel report-table-panel inventory-report-panel">
          <div className="report-heading-row">
            <div className="report-heading">
              <h2>Inventory Assets Valuation</h2>
              <p>Review every active product using its stored FIFO stock cost and estimated sales value.</p>
            </div>
            <button className="primary-action slim" type="button" onClick={download} disabled={!report.records.length}>Export CSV</button>
          </div>
          {error && <p className="report-inline-error" role="alert">The latest refresh failed: {error}</p>}
          {!report.records.length ? (
            <EmptyState>No active inventory products found.</EmptyState>
          ) : (
            <DataTable
              columns={['Product', 'Category', 'Unit', 'Stock', 'Reorder Level', 'Stock Cost Value', 'Estimated Sales Value', 'Status']}
              rows={report.records}
              searchPlaceholder="Search products or categories"
              getSortValue={(product, index) => [
                product.product_name,
                product.category,
                product.unit,
                safeNumber(product.stock_quantity),
                safeNumber(product.reorder_level),
                safeNumber(product.inventory_cost_value),
                safeNumber(product.estimated_sales_value),
                product.status,
              ][index]}
              renderRow={(product) => (
                <tr key={product.product_id} className={`valuation-row valuation-row-${String(product.status).toLowerCase().replaceAll(' ', '-')}`}>
                  <td><strong className="valuation-product-name">{product.product_name}</strong></td>
                  <td><span className="valuation-category">{product.category}</span></td>
                  <td>{product.unit}</td>
                  <td><span className="valuation-quantity">{formatQuantity(product.stock_quantity)}</span></td>
                  <td><span className="valuation-quantity">{formatQuantity(product.reorder_level)}</span></td>
                  <td><span className="valuation-money">{peso.format(safeNumber(product.inventory_cost_value))}</span></td>
                  <td><span className="valuation-money">{peso.format(safeNumber(product.estimated_sales_value))}</span></td>
                  <td><StatusBadge value={product.status} /></td>
                </tr>
              )}
            />
          )}
        </article>

        <aside className="panel donut-panel inventory-valuation-chart-panel" aria-labelledby="valuation-chart-title">
          <div className="report-heading valuation-chart-heading">
            <h2 id="valuation-chart-title">FIFO Stock Value by Product</h2>
            <p>All active products with a remaining FIFO cost value. Select a segment or legend item for details.</p>
          </div>

          {!chartProducts.length ? (
            <EmptyState>No products currently have a remaining FIFO stock value.</EmptyState>
          ) : (
            <>
              <div className="valuation-donut-stage">
                <svg className="valuation-donut" viewBox="0 0 200 200" role="group" aria-label={`FIFO stock cost by product. Total ${peso.format(totalCost)}`} data-chart-total={chartTotal.toFixed(2)}>
                  <circle className="valuation-donut-track" cx="100" cy="100" r={donutRadius} />
                  {segments.map((product) => {
                    const isActive = product.product_id === activeProductId
                    return (
                      <circle
                        className={`valuation-donut-segment${isActive ? ' is-active' : ''}${activeProductId && !isActive ? ' is-muted' : ''}`}
                        key={product.product_id}
                        cx="100"
                        cy="100"
                        r={donutRadius}
                        pathLength={donutCircumference}
                        stroke={product.chartColor}
                        strokeDasharray={`${product.dashLength} ${donutCircumference - product.dashLength}`}
                        strokeDashoffset={product.dashOffset}
                        role="button"
                        tabIndex="0"
                        aria-label={`${product.product_name}: ${peso.format(product.chartValue)}, ${(product.share * 100).toFixed(1)} percent of inventory value, ${formatQuantity(product.stock_quantity)} ${product.unit} available, category ${product.category}`}
                        aria-pressed={selectedProductId === product.product_id}
                        onPointerEnter={() => setHoveredProductId(product.product_id)}
                        onPointerLeave={() => setHoveredProductId(null)}
                        onFocus={() => setHoveredProductId(product.product_id)}
                        onBlur={() => setHoveredProductId(null)}
                        onClick={() => toggleSelectedProduct(product.product_id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            toggleSelectedProduct(product.product_id)
                          }
                        }}
                      >
                        <title>{product.product_name}: {peso.format(product.chartValue)}</title>
                      </circle>
                    )
                  })}
                </svg>
                <div className="valuation-donut-center" aria-hidden="true"><span>FIFO stock cost</span><strong>{peso.format(totalCost)}</strong></div>
              </div>

              <div className="valuation-tooltip" role="status" aria-live="polite">
                {activeProduct ? (
                  <>
                    <strong>{activeProduct.product_name}</strong>
                    <dl>
                      <div><dt>Inventory Value</dt><dd>{peso.format(activeProduct.chartValue)}</dd></div>
                      <div><dt>Share of Inventory</dt><dd>{((activeProduct.chartValue / chartTotal) * 100).toFixed(1)}%</dd></div>
                      <div><dt>Available Stock</dt><dd>{formatQuantity(activeProduct.stock_quantity)} {activeProduct.unit}</dd></div>
                      <div><dt>Category</dt><dd>{activeProduct.category}</dd></div>
                    </dl>
                  </>
                ) : (
                  <><strong>Product valuation details</strong><span>Hover, focus, or tap a product to inspect its contribution.</span></>
                )}
              </div>

              <div className="valuation-legend" aria-label="Product valuation legend">
                {segments.map((product) => (
                  <button
                    type="button"
                    key={product.product_id}
                    className={product.product_id === activeProductId ? 'is-active' : ''}
                    aria-pressed={selectedProductId === product.product_id}
                    onPointerEnter={() => setHoveredProductId(product.product_id)}
                    onPointerLeave={() => setHoveredProductId(null)}
                    onFocus={() => setHoveredProductId(product.product_id)}
                    onBlur={() => setHoveredProductId(null)}
                    onClick={() => toggleSelectedProduct(product.product_id)}
                  >
                    <i style={{ backgroundColor: product.chartColor }} aria-hidden="true" />
                    <span>{product.product_name}</span>
                    <strong>{peso.format(product.chartValue)}</strong>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="valuation-chart-summary">
            <span>Products with stock value <strong>{chartProducts.length}</strong></span>
            <span>Estimated sales value <strong>{peso.format(totalSalesValue)}</strong></span>
          </div>
          {!totalsReconcile && <p className="valuation-reconciliation-warning" role="alert">Product valuation details do not currently reconcile with the report total. Refresh the report before relying on the chart.</p>}
        </aside>
      </section>
    </div>
  )
}

export default InventoryValuation
