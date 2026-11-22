import { useEffect, useMemo, useState } from 'react'
import { Building2, MapPin, Phone, Search, Truck, UserRound, X } from 'lucide-react'
import { getStockInRecords } from '../../services/stockInService.js'
import { getSuppliers } from '../../services/supplierService.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import { getDeliveryChartTicks, getStaffSupplierMetrics } from '../../utils/staffSupplierMetrics.js'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import './StaffSuppliers.css'

function displayValue(value) {
  return typeof value === 'string' && value.trim() ? value : 'Not provided'
}

function DeliveryDate({ value }) {
  const date = formatActivityTimestamp(value)
  return <time dateTime={value}><span>{date.date}</span><small>{date.time}</small></time>
}

function StaffSuppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [stockInRecords, setStockInRecords] = useState([])
  const [selectedSupplierId, setSelectedSupplierId] = useState('')
  const [search, setSearch] = useState('')
  const [suppliersLoading, setSuppliersLoading] = useState(true)
  const [stockInLoading, setStockInLoading] = useState(true)
  const [suppliersError, setSuppliersError] = useState('')
  const [stockInError, setStockInError] = useState('')
  const [supplierReload, setSupplierReload] = useState(0)
  const [stockInReload, setStockInReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    getSuppliers({ signal: controller.signal })
      .then((data) => {
        if (!active) return
        setSuppliers(data)
        setSelectedSupplierId((current) => (
          data.some((supplier) => String(supplier.supplier_id) === current)
            ? current
            : data[0] ? String(data[0].supplier_id) : ''
        ))
        setSuppliersError('')
      })
      .catch((requestError) => {
        if (active && requestError.name !== 'AbortError') setSuppliersError(requestError.message)
      })
      .finally(() => { if (active) setSuppliersLoading(false) })
    return () => { active = false; controller.abort() }
  }, [supplierReload])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    getStockInRecords({ signal: controller.signal })
      .then((data) => {
        if (!active) return
        setStockInRecords(data)
        setStockInError('')
      })
      .catch((requestError) => {
        if (active && requestError.name !== 'AbortError') setStockInError(requestError.message)
      })
      .finally(() => { if (active) setStockInLoading(false) })
    return () => { active = false; controller.abort() }
  }, [stockInReload])

  const selectedSupplier = suppliers.find((supplier) => String(supplier.supplier_id) === selectedSupplierId) || null
  const supplierRecords = useMemo(() => (
    selectedSupplier
      ? stockInRecords.filter((record) => String(record.supplier_id) === String(selectedSupplier.supplier_id))
      : []
  ), [selectedSupplier, stockInRecords])
  const metrics = useMemo(() => getStaffSupplierMetrics(supplierRecords, selectedSupplier?.supplier_id), [selectedSupplier, supplierRecords])
  const filteredRecent = useMemo(() => {
    const searchTerm = search.trim().toLocaleLowerCase()
    if (!searchTerm) return metrics.recentDeliveries
    return metrics.recentDeliveries.filter((record) => {
      const formattedDate = formatActivityTimestamp(record.delivery_date)
      return [`DLV-${record.stockin_id}`, record.product_name, `${formattedDate.date} ${formattedDate.time}`]
        .some((value) => String(value || '').toLocaleLowerCase().includes(searchTerm))
    })
  }, [metrics.recentDeliveries, search])
  const chartMaximum = Math.max(1, ...metrics.monthlyActivity.map((item) => item.deliveries))
  const chartTicks = getDeliveryChartTicks(chartMaximum)
  const monthlyDeliveryTotal = metrics.monthlyActivity.reduce((total, item) => total + item.deliveries, 0)
  const chartDescription = metrics.monthlyActivity.map((item) => `${item.label}: ${item.deliveries} ${item.deliveries === 1 ? 'delivery' : 'deliveries'}`).join(', ')
  const deliveryError = suppliersError || stockInError
  const retryDeliveryData = suppliersError ? retrySuppliers : retryStockIn

  function retrySuppliers() {
    setSuppliersError('')
    setSuppliersLoading(true)
    setSupplierReload((version) => version + 1)
  }

  function retryStockIn() {
    setStockInError('')
    setStockInLoading(true)
    setStockInReload((version) => version + 1)
  }

  const deliveryContentLoading = suppliersLoading || stockInLoading

  return (
    <section className="page-stack staff-suppliers">
      <section className="staff-suppliers-profile-section" aria-label="Supplier information">
        {suppliersLoading && <PageSkeleton variant="supplier-directory" label="supplier information" />}
        {!suppliersLoading && suppliersError && <div className="staff-suppliers-error" role="alert">
          <p>Supplier information could not be loaded. {suppliersError}</p>
          <button className="secondary-action slim" type="button" onClick={retrySuppliers}>Try again</button>
        </div>}
        {!suppliersLoading && !suppliersError && suppliers.length === 0 && <article className="panel staff-suppliers-empty-profile">
          <EmptyState>No active supplier is registered yet.</EmptyState>
        </article>}
        {!suppliersLoading && !suppliersError && selectedSupplier && <article className="panel staff-supplier-profile">
          <div className="staff-supplier-profile-icon"><Building2 size={21} aria-hidden="true" /></div>
          <div className="staff-supplier-profile-main">
            <div className="staff-supplier-profile-heading">
              <div><p className="staff-suppliers-section-kicker">Supplier information</p><h2>{selectedSupplier.supplier_name}</h2><span className="staff-supplier-reference">SUP-{selectedSupplier.supplier_id}</span></div>
              <StatusBadge value="Active" />
            </div>
            <dl className="staff-supplier-profile-fields">
              <div><dt><UserRound size={15} aria-hidden="true" /> Contact person</dt><dd>{displayValue(selectedSupplier.contact_person)}</dd></div>
              <div><dt><Phone size={15} aria-hidden="true" /> Phone number</dt><dd>{displayValue(selectedSupplier.contact_number)}</dd></div>
              <div className="staff-supplier-address-field"><dt><MapPin size={15} aria-hidden="true" /> Business address</dt><dd>{displayValue(selectedSupplier.address)}</dd></div>
            </dl>
            {suppliers.length > 1 && <label className="staff-supplier-select-label">Choose an active supplier
              <select value={selectedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)}>
                {suppliers.map((supplier) => <option key={supplier.supplier_id} value={supplier.supplier_id}>{supplier.supplier_name}</option>)}
              </select>
            </label>}
          </div>
        </article>}
      </section>

      <section className="staff-supplier-delivery-summary" aria-label="Delivery summary">
        <article className="panel staff-supplier-metric-card">
          <span className="staff-supplier-metric-icon"><Truck size={18} aria-hidden="true" /></span>
          <div><p>Total Deliveries</p>
            {deliveryContentLoading ? <span className="staff-supplier-metric-skeleton" aria-hidden="true" />
              : suppliersError ? <button className="staff-supplier-inline-retry" type="button" onClick={retrySuppliers}>Retry loading supplier</button>
                : stockInError ? <button className="staff-supplier-inline-retry" type="button" onClick={retryStockIn}>Retry loading deliveries</button>
                : selectedSupplier ? <><strong>{metrics.totalDeliveries.toLocaleString('en-PH')}</strong><small>Posted Stock-In records</small></>
                  : <strong className="staff-supplier-no-delivery">No active supplier</strong>}
          </div>
        </article>
        <article className="panel staff-supplier-metric-card">
          <span className="staff-supplier-metric-icon"><MapPin size={18} aria-hidden="true" /></span>
          <div><p>Last Delivery</p>
            {deliveryContentLoading ? <span className="staff-supplier-metric-skeleton" aria-hidden="true" />
              : deliveryError ? <span className="staff-supplier-metric-error">Delivery history unavailable</span>
                : !selectedSupplier ? <strong className="staff-supplier-no-delivery">No active supplier</strong>
                : metrics.lastDelivery ? <strong className="staff-supplier-last-date">{formatActivityTimestamp(metrics.lastDelivery.delivery_date).date}</strong>
                  : <strong className="staff-supplier-no-delivery">No deliveries recorded.</strong>}
          </div>
        </article>
      </section>

      <section className="panel staff-supplier-monthly-panel" aria-labelledby="staff-supplier-monthly-title">
        <div className="staff-supplier-panel-heading"><div><h2 id="staff-supplier-monthly-title">Monthly Delivery Activity</h2><p>Posted Stock-In records across the previous six calendar months.</p></div>
          {!deliveryContentLoading && !deliveryError && selectedSupplier && <span className="staff-supplier-chart-total">{monthlyDeliveryTotal} {monthlyDeliveryTotal === 1 ? 'delivery' : 'deliveries'} · 6 months</span>}
        </div>
        {deliveryContentLoading && <PageSkeleton variant="supplier-chart" label="monthly delivery activity" />}
        {!deliveryContentLoading && deliveryError && <div className="staff-suppliers-error" role="alert"><p>Monthly activity could not be loaded. {deliveryError}</p><button className="secondary-action slim" type="button" onClick={retryDeliveryData}>Try again</button></div>}
        {!deliveryContentLoading && !deliveryError && !selectedSupplier && <EmptyState>No active supplier is available for delivery activity.</EmptyState>}
        {!deliveryContentLoading && !deliveryError && selectedSupplier && monthlyDeliveryTotal === 0 && <EmptyState>No delivery activity recorded for the last six months.</EmptyState>}
        {!deliveryContentLoading && !deliveryError && selectedSupplier && monthlyDeliveryTotal > 0 && <figure className="staff-supplier-chart" aria-label={`Monthly delivery activity. ${chartDescription}`}>
          <div className="staff-supplier-chart-axis-title">Deliveries</div>
          <div className="staff-supplier-chart-y-axis" aria-hidden="true">
            {chartTicks.map((tick) => <span key={tick} style={{ bottom: `${(tick / chartMaximum) * 100}%` }}>{tick}</span>)}
          </div>
          <div className="staff-supplier-chart-plot" role="group" aria-label="Delivery counts by month">
            <div className="staff-supplier-chart-grid">
              {chartTicks.map((tick) => <span className="staff-supplier-chart-gridline" key={tick} style={{ bottom: `${(tick / chartMaximum) * 100}%` }} aria-hidden="true" />)}
            </div>
            <div className="staff-supplier-chart-bars">
              {metrics.monthlyActivity.map((item) => {
                const deliveryLabel = `${item.tooltipLabel}\n${item.deliveries} ${item.deliveries === 1 ? 'delivery' : 'deliveries'}`
                const height = (item.deliveries / chartMaximum) * 100
                return <div className="staff-supplier-chart-column" key={item.key} tabIndex={0} role="img" aria-label={deliveryLabel.replace('\n', ', ')} data-tooltip={deliveryLabel}>
                  <div className="staff-supplier-chart-bar-track">
                    {item.deliveries === 0
                      ? <span className="staff-supplier-chart-zero">0</span>
                      : <span className="staff-supplier-chart-bar" style={{ height: `${height}%` }}><span className="staff-supplier-chart-value">{item.deliveries}</span></span>}
                  </div>
                  <span className="staff-supplier-chart-month">{item.label}</span>
                </div>
              })}
            </div>
          </div>
        </figure>}
      </section>

      <section className="panel staff-supplier-recent-panel" aria-labelledby="staff-supplier-recent-title">
        <div className="staff-supplier-panel-heading staff-supplier-recent-heading">
          <div><h2 id="staff-supplier-recent-title">Recent Deliveries</h2><p>The five most recent Stock-In records for this supplier.</p></div>
        </div>
        <div className="staff-supplier-recent-controls">
          <label className="staff-suppliers-search">
            <Search size={16} aria-hidden="true" /><span className="sr-only">Search the five most recent deliveries</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search deliveries..." aria-controls="staff-supplier-recent-table" />
            {search && <button type="button" className="staff-supplier-search-clear" onClick={() => setSearch('')} aria-label="Clear delivery search"><X size={15} aria-hidden="true" /></button>}
          </label>
          {!deliveryContentLoading && !deliveryError && selectedSupplier && (
            <span className="staff-supplier-recent-count" aria-live="polite">
              {filteredRecent.length} {filteredRecent.length === 1 ? 'delivery' : 'deliveries'}
            </span>
          )}
        </div>
        {deliveryContentLoading && <PageSkeleton variant="inventory-inflow" label="recent deliveries" />}
        {!deliveryContentLoading && deliveryError && <div className="staff-suppliers-error" role="alert"><p>Recent deliveries could not be loaded. {deliveryError}</p><button className="secondary-action slim" type="button" onClick={retryDeliveryData}>Try again</button></div>}
        {!deliveryContentLoading && !deliveryError && !selectedSupplier && <EmptyState>No active supplier is available to show deliveries.</EmptyState>}
        {!deliveryContentLoading && !deliveryError && selectedSupplier && metrics.recentDeliveries.length === 0 && <EmptyState>No deliveries recorded yet.</EmptyState>}
        {!deliveryContentLoading && !deliveryError && metrics.recentDeliveries.length > 0 && filteredRecent.length === 0 && <EmptyState>No recent deliveries match your search.</EmptyState>}
        {!deliveryContentLoading && !deliveryError && filteredRecent.length > 0 && <div id="staff-supplier-recent-table" className="staff-supplier-recent-table-wrap">
          <DataTable
            columns={['Delivery reference', 'Delivery date', 'Product', 'Quantity received']}
            rows={filteredRecent}
            pageSize={5}
            externalPagination
            searchable={false}
            nonSortableColumns={['Delivery reference', 'Delivery date', 'Product', 'Quantity received']}
            renderRow={(record) => (
              <tr key={record.stockin_id}>
                <td data-label="Delivery reference"><strong>DLV-{record.stockin_id}</strong></td>
                <td data-label="Delivery date"><DeliveryDate value={record.delivery_date} /></td>
                <td data-label="Product"><strong>{displayValue(record.product_name)}</strong></td>
                <td data-label="Quantity received">{Number(record.quantity_received).toLocaleString('en-PH', { maximumFractionDigits: 3 })} {record.unit}</td>
              </tr>
            )}
          />
        </div>}
      </section>
    </section>
  )
}

export default StaffSuppliers
