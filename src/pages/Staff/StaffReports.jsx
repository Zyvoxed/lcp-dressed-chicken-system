import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Boxes,
  Download,
  PackageCheck,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  UsersRound,
  WalletCards,
  X,
} from 'lucide-react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import StatCard from '../Shared/StatCard.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import StaffCustomerCreditsModal from './StaffCustomerCreditsModal.jsx'
import { getAllOperationalReport, getOperationalReport } from '../../services/reportService.js'
import { exportCsv, manilaDateStamp } from '../../utils/csvExport.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'
import './StaffReports.css'

const tabs = {
  sales: 'Sales Activity Audit',
  inventory: 'Inventory Status',
  receivables: 'Customer Receivables Ledger',
}

const staffTabs = [
  { key: tabs.sales, icon: TrendingUp },
  { key: tabs.inventory, icon: Boxes },
  { key: tabs.receivables, icon: WalletCards },
]

const emptyFilters = { start_date: '', end_date: '', payment_type: '', status: '', search: '' }

function quantity(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('en-PH', { maximumFractionDigits: 3 }) : '0'
}

function asDate(value) {
  if (!value) return '—'
  return formatActivityTimestamp(value).dateTime
}

function StaffReports() {
  const [activeTab, setActiveTab] = useState(tabs.sales)
  const [filters, setFilters] = useState(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters)
  const [page, setPage] = useState(1)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryVersion, setRetryVersion] = useState(0)
  const [selectedCustomer, setSelectedCustomer] = useState(null)

  // Quick filter drawer state for Inventory & Receivables
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [stockStatusFilter, setStockStatusFilter] = useState('All')
  const [balanceBracketFilter, setBalanceBracketFilter] = useState('All')

  const reportType = activeTab === tabs.sales
    ? 'sales'
    : activeTab === tabs.receivables
      ? 'receivables'
      : 'inventory'

  const skeletonVariant = reportType === 'sales'
    ? 'report-sales'
    : reportType === 'receivables'
      ? 'report-receivables'
      : 'report-inventory'

  useEffect(() => {
    const controller = new AbortController()
    async function fetchReport() {
      try {
        const result = await getOperationalReport(reportType, {
          ...appliedFilters,
          page,
          page_size: 25,
        }, { signal: controller.signal })
        if (!controller.signal.aborted) {
          setReport(result)
          setError('')
        }
      } catch (requestError) {
        if (requestError.name !== 'AbortError' && !controller.signal.aborted) {
          setError(requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    fetchReport()
    return () => controller.abort()
  }, [appliedFilters, page, reportType, retryVersion])

  function changeTab(tab) {
    setActiveTab(tab)
    setPage(1)
    setSelectedCustomer(null)
    setReport(null)
    setError('')
    setLoading(true)
    setIsFilterOpen(false)
    setCategoryFilter('All')
    setStockStatusFilter('All')
    setBalanceBracketFilter('All')
  }

  function applyFilters(event) {
    if (event) event.preventDefault()
    setPage(1)
    setReport(null)
    setError('')
    setLoading(true)
    setAppliedFilters({ ...filters, search: filters.search.trim() })
  }

  function clearFilters() {
    setFilters(emptyFilters)
    setAppliedFilters(emptyFilters)
    setCategoryFilter('All')
    setStockStatusFilter('All')
    setBalanceBracketFilter('All')
    setPage(1)
    setReport(null)
    setError('')
    setLoading(true)
  }

  function changePage(nextPage) {
    setPage(nextPage)
    setReport(null)
    setError('')
    setLoading(true)
  }

  const records = useMemo(() => report?.records || [], [report?.records])

  // Client-side quick filter computation for Inventory and Receivables
  const filteredRecords = useMemo(() => {
    if (!records.length) return []
    let list = records
    if (reportType === 'inventory') {
      if (categoryFilter !== 'All') {
        list = list.filter((item) => item.category === categoryFilter)
      }
      if (stockStatusFilter !== 'All') {
        list = list.filter((item) => {
          if (stockStatusFilter === 'Low Stock') {
            return Number(item.stock_quantity) <= Number(item.reorder_level) && Number(item.stock_quantity) > 0
          }
          if (stockStatusFilter === 'Out of Stock') {
            return Number(item.stock_quantity) === 0 || item.status === 'Out of Stock'
          }
          if (stockStatusFilter === 'In Stock') {
            return Number(item.stock_quantity) > Number(item.reorder_level)
          }
          return item.status === stockStatusFilter
        })
      }
    } else if (reportType === 'receivables') {
      if (balanceBracketFilter === 'high') {
        list = list.filter((cust) => Number(cust.current_balance) >= 5000)
      } else if (balanceBracketFilter === 'med') {
        list = list.filter((cust) => Number(cust.current_balance) >= 1000 && Number(cust.current_balance) < 5000)
      } else if (balanceBracketFilter === 'low') {
        list = list.filter((cust) => Number(cust.current_balance) < 1000)
      }
    }
    return list
  }, [records, reportType, categoryFilter, stockStatusFilter, balanceBracketFilter])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (reportType === 'inventory') {
      if (categoryFilter !== 'All') count += 1
      if (stockStatusFilter !== 'All') count += 1
    } else if (reportType === 'receivables') {
      if (balanceBracketFilter !== 'All') count += 1
    }
    return count
  }, [reportType, categoryFilter, stockStatusFilter, balanceBracketFilter])

  async function download() {
    if (!records.length) return
    try {
      if (reportType === 'sales') {
        const result = await getAllOperationalReport('sales', appliedFilters, { exportReport: true })
        const exportRecords = result.records || []
        exportCsv(
          `sales-activity-${manilaDateStamp()}.csv`,
          ['Transaction Reference', 'Date', 'Customer', 'Products Sold', 'Quantity by Unit', 'Payment Type', 'Status'],
          exportRecords.map((sale) => [
            `OR-${sale.sale_id}`,
            asDate(sale.sale_date),
            sale.customer_name,
            (sale.products_sold || []).map((item) => `${item.product_name} (${quantity(item.quantity_sold)} ${item.unit})`).join('; '),
            (sale.quantity_by_unit || []).map((item) => `${quantity(item.total_quantity)} ${item.unit}`).join('; '),
            sale.payment_type,
            sale.status,
          ]),
        )
      } else if (reportType === 'inventory') {
        exportCsv(
          `inventory-status-${manilaDateStamp()}.csv`,
          ['Product', 'Category', 'Unit', 'Available Quantity', 'Reorder Level', 'Status'],
          filteredRecords.map((item) => [
            item.product_name,
            item.category || '—',
            item.unit,
            item.stock_quantity,
            item.reorder_level,
            item.status,
          ]),
        )
      } else {
        exportCsv(
          `customer-receivables-${manilaDateStamp()}.csv`,
          ['Customer', 'Outstanding Balance'],
          filteredRecords.map((customer) => [customer.customer_name, customer.current_balance]),
        )
      }
    } catch (exportError) {
      setError(exportError.message)
    }
  }

  const summary = report?.summary || {}
  const unitsSummary = useMemo(
    () =>
      (summary.quantity_by_unit || [])
        .map((item) => `${quantity(item.total_quantity)} ${item.unit}`)
        .join(' · ') || 'No quantity recorded',
    [summary.quantity_by_unit],
  )

  function renderReportTable(rowsToRender = records) {
    if (!rowsToRender.length) {
      return <EmptyState>No records match the selected filters or search.</EmptyState>
    }

    if (reportType === 'sales') {
      return (
        <DataTable
          columns={['Transaction', 'Date & Time', 'Customer', 'Products Sold', 'Quantity', 'Payment', 'Status']}
          rows={rowsToRender}
          pageSize={25}
          externalPagination
          searchable={false}
          nonSortableColumns={['Transaction', 'Date & Time', 'Customer', 'Products Sold', 'Quantity', 'Payment', 'Status']}
          getSortValue={(sale, index) =>
            [
              sale.sale_id,
              sale.sale_date,
              sale.customer_name,
              (sale.products_sold || []).map((item) => item.product_name).join(' '),
              (sale.quantity_by_unit || []).map((item) => Number(item.total_quantity)).join(' '),
              sale.payment_type,
              sale.status,
            ][index]
          }
          renderRow={(sale) => (
            <tr key={sale.sale_id}>
              <td><strong className="report-transaction-reference">OR-{sale.sale_id}</strong></td>
              <td><time dateTime={sale.sale_date}>{asDate(sale.sale_date)}</time></td>
              <td>{sale.customer_name}</td>
              <td>
                {(sale.products_sold || [])
                  .map((item) => `${item.product_name} (${quantity(item.quantity_sold)} ${item.unit})`)
                  .join(', ') || '—'}
              </td>
              <td className="cell-right">
                {(sale.quantity_by_unit || [])
                  .map((item) => `${quantity(item.total_quantity)} ${item.unit}`)
                  .join(', ') || '—'}
              </td>
              <td>{sale.payment_type}</td>
              <td><StatusBadge value={sale.status} /></td>
            </tr>
          )}
        />
      )
    }

    if (reportType === 'inventory') {
      return (
        <div className="staff-inventory-status-table">
          <DataTable
            columns={['Product', 'Category', 'Unit', 'Available', 'Reorder Level', 'Status']}
            rows={rowsToRender}
            pageSize={25}
            externalPagination
            searchable={false}
            nonSortableColumns={['Product', 'Category', 'Unit', 'Available', 'Reorder Level', 'Status']}
            renderRow={(item) => (
              <tr key={item.product_id}>
                <td><strong>{item.product_name}</strong></td>
                <td>{item.category || '—'}</td>
                <td>{item.unit}</td>
                <td className="cell-right">{quantity(item.stock_quantity)} {item.unit}</td>
                <td className="cell-right">{quantity(item.reorder_level)} {item.unit}</td>
                <td><StatusBadge value={item.status} /></td>
              </tr>
            )}
          />
        </div>
      )
    }

    return (
      <div className="staff-receivables-ledger-table">
        <DataTable
          columns={['Customer', 'Outstanding Balance', 'Actions']}
          rows={rowsToRender}
          pageSize={25}
          externalPagination
          searchable={false}
          nonSortableColumns={['Customer', 'Outstanding Balance', 'Actions']}
          renderRow={(customer) => (
            <tr key={customer.customer_id}>
              <td><strong>{customer.customer_name}</strong></td>
              <td className="cell-right font-mono">
                {Number(customer.current_balance || 0).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}
              </td>
              <td className="cell-right">
                <button
                  type="button"
                  className="secondary-action slim"
                  aria-label={`View Credits for ${customer.customer_name}`}
                  onClick={() => setSelectedCustomer(customer)}
                >
                  View Credits
                </button>
              </td>
            </tr>
          )}
        />
      </div>
    )
  }

  function renderStaffTabs() {
    return (
      <nav className="reports-tabs-container" aria-label="Reports section navigation">
        <div className="reports-segmented-control" role="tablist" aria-label="Report Views">
          {staffTabs.map(({ key, icon: Icon }) => {
            const selected = activeTab === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`reports-nav-tab ${selected ? 'active' : ''}`}
                onClick={() => changeTab(key)}
              >
                <span className="reports-tab-icon">
                  <Icon size={16} strokeWidth={selected ? 2.2 : 1.8} aria-hidden="true" />
                </span>
                <span className="reports-tab-label">{key}</span>
              </button>
            )
          })}
        </div>
      </nav>
    )
  }

  return (
    <section className="reports-page page-stack staff-reports">
      {renderStaffTabs()}

      {loading && !report && !error ? (
        <PageSkeleton variant={skeletonVariant} label="operational report" />
      ) : (
        <div className="report-tab-content">
          {reportType === 'sales' && (
            <div className="stats-grid report-stats report-sales-stats">
              <StatCard
                icon={Activity}
                label="Transactions"
                value={Number(summary.transaction_count || 0).toLocaleString('en-PH')}
                helper="Matching current filters"
              />
              <StatCard
                icon={Boxes}
                label="Units Sold"
                value={unitsSummary}
                helper="Grouped by configured product unit"
              />
            </div>
          )}

          {reportType === 'inventory' && (
            <div className="stats-grid report-stats report-inventory-stats">
              <StatCard
                icon={PackageCheck}
                label="Active Products"
                value={Number(summary.active_products || 0).toLocaleString('en-PH')}
                helper="Active catalog items"
              />
              <StatCard
                icon={Boxes}
                label="Available Quantities"
                value={unitsSummary}
                helper="Grouped by product unit"
              />
              <StatCard
                icon={Activity}
                label="Low Stock"
                value={Number(summary.low_stock_products || 0).toLocaleString('en-PH')}
                helper="At or below reorder level"
              />
              <StatCard
                icon={Activity}
                label="Out of Stock"
                value={Number(summary.out_of_stock_products || 0).toLocaleString('en-PH')}
                helper="No available stock"
              />
            </div>
          )}

          {reportType === 'receivables' && (
            <div className="stats-grid report-stats report-receivables-stats">
              <StatCard
                icon={UsersRound}
                label="Customers with Balance"
                value={Number(summary.customers_with_balance || 0).toLocaleString('en-PH')}
                helper="Active customers with credit"
              />
              <StatCard
                icon={WalletCards}
                label="Outstanding Balances"
                value={Number(summary.total_receivables || 0).toLocaleString('en-PH', {
                  style: 'currency',
                  currency: 'PHP',
                })}
                helper="Current aggregate balance"
              />
            </div>
          )}

          {/* TAB 1: SALES ACTIVITY (Clean 2-column layout with sidebar filters) */}
          {reportType === 'sales' ? (
            <section className="report-layout sales-layout">
              <article className="panel table-panel report-table-panel sales-report-panel">
                <div className="report-heading-row sales-report-heading-row">
                  <div className="report-heading">
                    <h2>{activeTab}</h2>
                    <p>Review authorized operational sales records.</p>
                  </div>
                </div>
                <div className="staff-sales-report-tools">
                  <label className="staff-sales-report-search">
                    <Search size={15} aria-hidden="true" />
                    <input
                      type="search"
                      form="staff-sales-report-filters"
                      aria-label="Search sales activity report"
                      value={filters.search}
                      placeholder="Search OR reference, customer..."
                      onChange={(e) => setFilters((cur) => ({ ...cur, search: e.target.value }))}
                    />
                  </label>
                  {report?.pagination && (
                    <span className="report-result-count">{report.pagination.total_records} records</span>
                  )}
                </div>

                {error && (
                  <p className="report-inline-error" role="alert">
                    {error}{' '}
                    <button
                      type="button"
                      className="secondary-action slim"
                      onClick={() => {
                        setReport(null)
                        setError('')
                        setLoading(true)
                        setRetryVersion((current) => current + 1)
                      }}
                    >
                      Try Again
                    </button>
                  </p>
                )}

                {loading && report && <p role="status">Refreshing report…</p>}
                {!error && report && renderReportTable(records)}

                {report?.pagination?.total_pages > 1 && (
                  <div className="table-pagination" aria-label="Report pages">
                    <span>Page {report.pagination.page} of {report.pagination.total_pages}</span>
                    <div>
                      <button
                        type="button"
                        aria-label="Previous page"
                        disabled={loading || page <= 1}
                        onClick={() => changePage(page - 1)}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        aria-label="Next page"
                        disabled={loading || page >= report.pagination.total_pages}
                        onClick={() => changePage(page + 1)}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                )}
              </article>

              <form id="staff-sales-report-filters" className="report-filter-panel" onSubmit={applyFilters}>
                <div className="report-heading report-filter-heading">
                  <h2>Report Filters</h2>
                  <p>Filter permitted sales data.</p>
                </div>

                <label>
                  Start Date
                  <input
                    type="date"
                    value={filters.start_date}
                    onChange={(e) => setFilters((cur) => ({ ...cur, start_date: e.target.value }))}
                  />
                </label>

                <label>
                  End Date
                  <input
                    type="date"
                    value={filters.end_date}
                    onChange={(e) => setFilters((cur) => ({ ...cur, end_date: e.target.value }))}
                  />
                </label>

                <label>
                  Payment Type
                  <select
                    value={filters.payment_type}
                    onChange={(e) => setFilters((cur) => ({ ...cur, payment_type: e.target.value }))}
                  >
                    <option value="">All payment types</option>
                    <option value="Cash">Cash</option>
                    <option value="Credit">Credit</option>
                  </select>
                </label>

                <label>
                  Status
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters((cur) => ({ ...cur, status: e.target.value }))}
                  >
                    <option value="">All statuses</option>
                    <option value="Paid">Paid</option>
                    <option value="Partially Paid">Partially Paid</option>
                    <option value="Unpaid">Unpaid</option>
                  </select>
                </label>

                <div className="report-filter-actions">
                  <button className="primary-action" type="submit" disabled={loading}>
                    Apply Filters
                  </button>
                  <button className="secondary-action" type="button" onClick={clearFilters} disabled={loading}>
                    Clear Filters
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={download}
                    disabled={!records.length || loading}
                  >
                    <Download size={15} aria-hidden="true" />
                    Export CSV
                  </button>
                </div>
              </form>
            </section>
          ) : (
            /* TABS 2 & 3: INVENTORY STATUS & RECEIVABLES LEDGER (Clean full-width layout with search + filter button) */
            <section className="report-layout full-width">
              <article className="staff-reports-single-panel">
                <header className="staff-panel-header">
                  <div className="staff-panel-heading">
                    <div className="staff-panel-title-row">
                      <h2>{activeTab}</h2>
                      {report?.pagination && (
                        <span className="report-result-count">
                          {filteredRecords.length !== records.length
                            ? `${filteredRecords.length} of ${report.pagination.total_records} records`
                            : `${report.pagination.total_records} records`}
                        </span>
                      )}
                    </div>
                    <p className="staff-panel-subtitle">
                      {reportType === 'inventory'
                        ? 'Review catalog stock levels, categories, and reorder warnings.'
                        : 'Track customers with active credit balances and review detailed credit history.'}
                    </p>
                  </div>

                  <div className="staff-toolbar-controls">
                    {/* Search Bar */}
                    <form onSubmit={applyFilters} className="staff-search-input-wrap">
                      <span className="staff-search-icon" aria-hidden="true">
                        <Search size={15} />
                      </span>
                      <input
                        type="search"
                        className="staff-search-input"
                        value={filters.search}
                        placeholder={
                          reportType === 'inventory' ? 'Search product or category...' : 'Search customer name...'
                        }
                        onChange={(e) => setFilters((cur) => ({ ...cur, search: e.target.value }))}
                      />
                      {filters.search && (
                        <button
                          type="button"
                          className="staff-search-clear-btn"
                          onClick={() => {
                            setFilters((cur) => ({ ...cur, search: '' }))
                            setAppliedFilters((cur) => ({ ...cur, search: '' }))
                            setPage(1)
                          }}
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </form>

                    {/* Filter Button */}
                    <button
                      type="button"
                      className={`staff-filter-btn ${isFilterOpen || activeFilterCount > 0 ? 'active' : ''}`}
                      onClick={() => setIsFilterOpen(!isFilterOpen)}
                      aria-expanded={isFilterOpen}
                      title="Toggle filter options"
                    >
                      <SlidersHorizontal size={15} aria-hidden="true" />
                      <span>Filters</span>
                      {activeFilterCount > 0 && <span className="staff-filter-badge">{activeFilterCount}</span>}
                    </button>

                    {/* Export CSV Button */}
                    <button
                      type="button"
                      className="secondary-action slim staff-export-csv-btn"
                      onClick={download}
                      disabled={!records.length || loading}
                      title="Export CSV"
                    >
                      <Download size={15} aria-hidden="true" />
                      <span>Export CSV</span>
                    </button>

                    {/* Reset Filters Button if any filters or search are active */}
                    {(appliedFilters.search ||
                      categoryFilter !== 'All' ||
                      stockStatusFilter !== 'All' ||
                      balanceBracketFilter !== 'All') && (
                      <button
                        type="button"
                        className="secondary-action slim"
                        onClick={() => {
                          clearFilters()
                          setCategoryFilter('All')
                          setStockStatusFilter('All')
                          setBalanceBracketFilter('All')
                        }}
                        title="Reset all filters"
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>
                </header>

                {/* Expandable Filter Drawer when Filter button is active */}
                {isFilterOpen && (
                  <div className="staff-filter-drawer">
                    {reportType === 'inventory' ? (
                      <>
                        <div className="staff-filter-row">
                          <span className="staff-filter-label">Category:</span>
                          <div className="staff-filter-pills">
                            {['All', 'Whole Chicken', 'Prime Cuts', 'Wings & Drumsticks', 'Innards & Offal'].map(
                              (cat) => (
                                <button
                                  key={cat}
                                  type="button"
                                  className={`staff-pill-btn ${categoryFilter === cat ? 'active' : ''}`}
                                  onClick={() => setCategoryFilter(cat)}
                                >
                                  {cat}
                                </button>
                              ),
                            )}
                          </div>
                        </div>

                        <div className="staff-filter-row">
                          <span className="staff-filter-label">Stock Status:</span>
                          <div className="staff-filter-pills">
                            {['All', 'In Stock', 'Low Stock', 'Out of Stock'].map((st) => (
                              <button
                                key={st}
                                type="button"
                                className={`staff-pill-btn ${stockStatusFilter === st ? 'active' : ''}`}
                                onClick={() => setStockStatusFilter(st)}
                              >
                                {st}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="staff-filter-row">
                        <span className="staff-filter-label">Balance:</span>
                        <div className="staff-filter-pills">
                          {[
                            { label: 'All Balances', value: 'All' },
                            { label: 'High (₱5,000+)', value: 'high' },
                            { label: 'Medium (₱1,000 - ₱5,000)', value: 'med' },
                            { label: 'Low (< ₱1,000)', value: 'low' },
                          ].map((bracket) => (
                            <button
                              key={bracket.value}
                              type="button"
                              className={`staff-pill-btn ${balanceBracketFilter === bracket.value ? 'active' : ''}`}
                              onClick={() => setBalanceBracketFilter(bracket.value)}
                            >
                              {bracket.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="staff-table-body-wrap">
                  {error && (
                    <p className="report-inline-error staff-report-inline-message" role="alert">
                      {error}{' '}
                      <button
                        type="button"
                        className="secondary-action slim"
                        onClick={() => {
                          setReport(null)
                          setError('')
                          setLoading(true)
                          setRetryVersion((cur) => cur + 1)
                        }}
                      >
                        Try Again
                      </button>
                    </p>
                  )}

                  {loading && report && <p className="staff-report-inline-message" role="status">Refreshing report…</p>}
                  {!error && report && renderReportTable(filteredRecords)}

                  {report?.pagination?.total_pages > 1 && (
                    <div className="table-pagination" aria-label="Report pages">
                      <span>Page {report.pagination.page} of {report.pagination.total_pages}</span>
                      <div>
                        <button
                          type="button"
                          aria-label="Previous page"
                          disabled={loading || page <= 1}
                          onClick={() => changePage(page - 1)}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          aria-label="Next page"
                          disabled={loading || page >= report.pagination.total_pages}
                          onClick={() => changePage(page + 1)}
                        >
                          ›
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            </section>
          )}

          {selectedCustomer && (
            <StaffCustomerCreditsModal
              key={selectedCustomer.customer_id}
              customer={selectedCustomer}
              onClose={() => setSelectedCustomer(null)}
            />
          )}
        </div>
      )}
    </section>
  )
}

export default StaffReports
