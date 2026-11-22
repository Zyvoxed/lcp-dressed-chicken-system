import { useEffect, useState } from 'react'
import {
  Boxes,
  History,
  PackageCheck,
  ShoppingCart,
  TriangleAlert,
  Truck,
  WalletCards,
} from 'lucide-react'
import { getDashboard } from '../../services/dashboardService.js'
import { getInventoryProducts } from '../../services/productService.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import StaffSalesActivityChart from './StaffSalesActivityChart.jsx'

function StaffDashboard() {
  const [data, setData] = useState(null)
  const [products, setProducts] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      getDashboard({ signal: controller.signal }),
      getInventoryProducts({ signal: controller.signal }),
    ]).then(([dashboard, inventory]) => {
      setData(dashboard)
      setProducts(inventory)
    }).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [])

  if (loading) return <PageSkeleton variant="dashboard" label="operational dashboard" />
  if (error) return <EmptyState>{error}</EmptyState>
  if (!data) return <EmptyState>No operational data available.</EmptyState>

  const summary = data.summary || {}
  const quantitySoldFormatted = data.today_quantity_by_unit?.length
    ? data.today_quantity_by_unit
        .map((item) => `${Number(item.total_quantity).toLocaleString('en-PH', { maximumFractionDigits: 3 })} ${item.unit}`)
        .join(' · ')
    : '0'

  return (
    <section className="page-stack dashboard-page staff-dashboard">
      {/* 4 Core Operational KPI Cards */}
      <div className="dashboard-kpi-grid">
        <article className="dashboard-kpi-card positive">
          <div className="dashboard-kpi-heading">
            <p>Sales transactions today</p>
            <ShoppingCart size={18} aria-hidden="true" />
          </div>
          <strong title={Number(summary.today_transactions || 0).toLocaleString('en-PH')}>
            {Number(summary.today_transactions || 0).toLocaleString('en-PH')}
          </strong>
          <span>• Completed sales today</span>
        </article>

        <article className="dashboard-kpi-card neutral">
          <div className="dashboard-kpi-heading">
            <p>Quantity sold today</p>
            <PackageCheck size={18} aria-hidden="true" />
          </div>
          <strong title={quantitySoldFormatted}>
            {quantitySoldFormatted}
          </strong>
          <span>• Grouped by configured product unit</span>
        </article>

        <article className="dashboard-kpi-card neutral">
          <div className="dashboard-kpi-heading">
            <p>Active products</p>
            <Boxes size={18} aria-hidden="true" />
          </div>
          <strong title={products.length.toLocaleString('en-PH')}>
            {products.length.toLocaleString('en-PH')}
          </strong>
          <span>• {data.low_stock_alerts?.length || 0} low-stock alerts</span>
        </article>

        <article className="dashboard-kpi-card warning">
          <div className="dashboard-kpi-heading">
            <p>Outstanding customer balances</p>
            <WalletCards size={18} aria-hidden="true" />
          </div>
          <strong title={peso.format(Number(summary.outstanding_credits || 0))}>
            {peso.format(Number(summary.outstanding_credits || 0))}
          </strong>
          <span>• For bookkeeping follow-up</span>
        </article>
      </div>

      <StaffSalesActivityChart />

      {/* 2-Column Operational Grid */}
      <div className="dashboard-two-column-grid dashboard-operations-grid">
        {/* Card 1: Low-Stock Items */}
        <article className="panel dashboard-list-panel staff-low-stock-panel">
          <header>
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <TriangleAlert size={17} style={{ color: 'var(--status-danger-text)' }} aria-hidden="true" />
                LOW-STOCK ITEMS
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Products at or below their configured reorder levels.
              </p>
            </div>
            <span className={`dashboard-badge ${data.low_stock_alerts?.length ? 'danger' : ''}`}>
              {data.low_stock_alerts?.length || 0} ALERTS
            </span>
          </header>
          {!data.low_stock_alerts?.length ? (
            <EmptyState>No active products are at or below their reorder levels.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Available</th>
                    <th>Reorder Level</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.low_stock_alerts.map((item) => (
                    <tr key={item.product_id}>
                      <td><strong>{item.product_name}</strong></td>
                      <td>
                        <b style={{ color: 'var(--status-danger-text)' }}>
                          {Number(item.stock_quantity).toLocaleString('en-PH', { maximumFractionDigits: 3 })}
                        </b>{' '}
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.unit}</span>
                      </td>
                      <td>
                        {Number(item.reorder_level).toLocaleString('en-PH', { maximumFractionDigits: 3 })}{' '}
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.unit}</span>
                      </td>
                      <td><StatusBadge value={item.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {/* Card 2: Recent Stock Receipts */}
        <article className="panel dashboard-list-panel staff-receipts-panel">
          <header>
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Truck size={17} style={{ color: 'var(--primary)' }} aria-hidden="true" />
                RECENT STOCK RECEIPTS
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Recorded supplier deliveries and stock intake.
              </p>
            </div>
            <span className="dashboard-badge">
              LATEST {data.recent_stock_in?.length || 0}
            </span>
          </header>
          {!data.recent_stock_in?.length ? (
            <EmptyState>No stock receipts found.</EmptyState>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Supplier</th>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_stock_in.map((item) => (
                    <tr key={item.stockin_id}>
                      <td><strong className="inventory-batch-reference">DLV-{item.stockin_id}</strong></td>
                      <td>{item.supplier_name}</td>
                      <td><strong>{item.product_name}</strong></td>
                      <td>
                        <b>{Number(item.quantity_received).toLocaleString('en-PH', { maximumFractionDigits: 3 })}</b>{' '}
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.unit}</span>
                      </td>
                      <td>
                        <time dateTime={item.delivery_date}>
                          {formatActivityTimestamp(item.delivery_date).dateTime}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>

      {/* Card 3: Recent Sales and Payments */}
      <article className="panel dashboard-list-panel staff-transactions-panel">
        <header>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={17} style={{ color: 'var(--primary)' }} aria-hidden="true" />
              RECENT SALES AND PAYMENTS
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              Real-time sales receipts and customer credit collections.
            </p>
          </div>
          <span className="dashboard-badge">
            LATEST ACTIVITY
          </span>
        </header>
        {!data.recent_transactions?.length ? (
          <EmptyState>No recent transactions found.</EmptyState>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_transactions.map((item) => (
                  <tr key={`${item.transaction_type}-${item.reference_id}`}>
                    <td>
                      <span className={`staff-txn-type-badge ${item.transaction_type.toLowerCase()}`}>
                        {item.transaction_type}
                      </span>
                    </td>
                    <td>
                      <strong>{item.transaction_type === 'Sale' ? 'OR' : 'PAY'}-{item.reference_id}</strong>
                    </td>
                    <td>{item.customer_name}</td>
                    <td><StatusBadge value={item.status} /></td>
                    <td>
                      <time dateTime={item.occurred_at}>
                        {formatActivityTimestamp(item.occurred_at).dateTime}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  )
}

export default StaffDashboard
