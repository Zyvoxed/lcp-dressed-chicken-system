import { useEffect, useRef, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import ReportMetrics from './ReportMetrics.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import TransactionDetailsModal from './TransactionDetailsModal.jsx'
import { getAllSalesReport, getSalesReport, logReportExport } from '../../services/reportService.js'
import { exportCsv, manilaDateStamp } from '../../utils/csvExport.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

const emptyFilters = { start_date: '', end_date: '', payment_type: '' }

function RevenueReport() {
  const [filters, setFilters] = useState(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [selectedSaleId, setSelectedSaleId] = useState(null)
  const latestRequest = useRef(0)
  const searchTimer = useRef(null)

  async function loadReport(activeFilters = filters, page = 1, searchText = query, statusFilter = status) {
    const requestId = ++latestRequest.current
    setLoading(true)
    setError('')
    try {
      const nextReport = await getSalesReport({
        ...activeFilters,
        page,
        page_size: 25,
        search: searchText,
        status: statusFilter,
      })
      if (requestId === latestRequest.current) setReport(nextReport)
    } catch (requestError) {
      if (requestId === latestRequest.current) setError(requestError.message)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++latestRequest.current
    getSalesReport({ page: 1, page_size: 25 }, { signal: controller.signal })
      .then((value) => { if (requestId === latestRequest.current) setReport(value) })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      window.clearTimeout(searchTimer.current)
    }
  }, [])

  const filteredRecords = report?.records ?? []

  async function download() {
    try { await logReportExport('Sales & Revenue') } catch (logError) { console.error(logError.message) }
    const completeReport = await getAllSalesReport({
      ...appliedFilters,
      search: query,
      status,
    })
    exportCsv(
      `sales-report-${manilaDateStamp()}.csv`,
      ['Sale ID', 'Date', 'Customer', 'Recorded By', 'Payment Type', 'Total Amount', 'Amount Paid', 'Remaining Balance', 'Status'],
      completeReport.records.map((sale) => [`OR-${sale.sale_id}`, formatActivityTimestamp(sale.sale_date).dateTime, sale.customer_name, sale.recorded_by, sale.payment_type, sale.total_amount, sale.amount_paid, sale.remaining_balance, sale.status]),
    )
  }

  function resetFilters() {
    window.clearTimeout(searchTimer.current)
    setFilters(emptyFilters)
    setAppliedFilters(emptyFilters)
    setQuery('')
    setStatus('')
    loadReport(emptyFilters, 1, '', '')
  }

  function scheduleInteractiveSearch(nextQuery, nextStatus) {
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      loadReport(appliedFilters, 1, nextQuery, nextStatus)
    }, 250)
  }

  function applyFilters() {
    setAppliedFilters(filters)
    loadReport(filters, 1)
  }

  if (loading && !report) return <PageSkeleton variant="report-sales" label="sales and revenue report" />;
  if (error && !report) return <div className="panel report-state-panel"><EmptyState>{error}</EmptyState><button className="secondary-action slim" type="button" onClick={() => loadReport(appliedFilters)}>Try Again</button></div>
  if (!report) return <div className="panel report-state-panel"><EmptyState>No sales report data found.</EmptyState></div>

  return (
    <>
      <ReportMetrics summary={report.summary} />
      <section className="report-layout">
        <article className="panel table-panel report-table-panel sales-report-panel">
          <div className="report-heading-row">
            <div className="report-heading">
              <h2>Sales & Revenue Audit</h2>
              <p>Review recorded transactions and open a sale to inspect its stored products and payments.</p>
            </div>
            <span className="report-result-count" aria-live="polite">{filteredRecords.length} of {report.pagination?.total_records ?? filteredRecords.length} transactions</span>
          </div>

          <div className="report-local-filters" aria-label="Transaction search and status filters">
            <label>Search transactions<input type="search" value={query} placeholder="Transaction ID, customer, or staff" onChange={(event) => { const value = event.target.value; setQuery(value); scheduleInteractiveSearch(value, status) }} /></label>
            <label>Payment Status<select value={status} onChange={(event) => { const value = event.target.value; setStatus(value); scheduleInteractiveSearch(query, value) }}><option value="">All statuses</option><option value="Paid">Paid</option><option value="Partially Paid">Partially Paid</option><option value="Unpaid">Unpaid</option></select></label>
          </div>

          {error && <p className="report-inline-error" role="alert">{error}</p>}
          {!report.records.length ? <EmptyState>No sales transactions match the report filters.</EmptyState> : <DataTable
            columns={['Sale ID', 'Date', 'Customer', 'Recorded By', 'Payment Type', 'Total', 'Paid', 'Balance', 'Status']}
            rows={filteredRecords}
            pageSize={25}
            externalPagination
            searchable={false}
            getSortValue={(sale, index) => [sale.sale_id, sale.sale_date, sale.customer_name, sale.recorded_by, sale.payment_type, Number(sale.total_amount), Number(sale.amount_paid), Number(sale.remaining_balance), sale.status][index]}
            renderRow={(sale) => <tr
              key={sale.sale_id}
              className="sales-transaction-row"
              tabIndex={0}
              aria-label={`Open transaction details for OR-${sale.sale_id}`}
              aria-haspopup="dialog"
              onClick={() => setSelectedSaleId(sale.sale_id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedSaleId(sale.sale_id)
                }
              }}
            >
              <td><strong className="report-transaction-reference">OR-{sale.sale_id}</strong></td>
              <td><time dateTime={sale.sale_date}>{formatActivityTimestamp(sale.sale_date).dateTime}</time></td>
              <td>{sale.customer_name}</td><td>{sale.recorded_by}</td><td>{sale.payment_type}</td>
              <td>{peso.format(Number(sale.total_amount))}</td><td>{peso.format(Number(sale.amount_paid))}</td><td>{peso.format(Number(sale.remaining_balance))}</td><td><StatusBadge value={sale.status} /></td>
            </tr>}
          />}
          {report.pagination?.total_pages > 1 && <div className="table-pagination" aria-label="Sales report pages">
            <span>Page {report.pagination.page} of {report.pagination.total_pages}</span>
            <div>
              <button type="button" aria-label="Previous page" disabled={loading || report.pagination.page <= 1} onClick={() => loadReport(appliedFilters, report.pagination.page - 1)}>&lsaquo;</button>
              <button type="button" aria-label="Next page" disabled={loading || report.pagination.page >= report.pagination.total_pages} onClick={() => loadReport(appliedFilters, report.pagination.page + 1)}>&rsaquo;</button>
            </div>
          </div>}
        </article>
        <aside className="receipt-panel report-filter-panel">
          <div className="report-heading report-filter-heading"><h2>Report Filters</h2><p>Apply date and payment-type limits to the report dataset.</p></div>
          <label>Start Date<input type="date" value={filters.start_date} onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value }))} /></label>
          <label>End Date<input type="date" value={filters.end_date} onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value }))} /></label>
          <label>Payment Type<select value={filters.payment_type} onChange={(event) => setFilters((current) => ({ ...current, payment_type: event.target.value }))}><option value="">All payment types</option><option value="Cash">Cash</option><option value="Credit">Credit</option></select></label>
          <button className="secondary-action" type="button" disabled={loading} onClick={applyFilters}>{loading ? 'Generating…' : 'Apply Filters'}</button>
          <button className="secondary-action" type="button" disabled={loading} onClick={resetFilters}>Clear Filters</button>
          <button className="primary-action" type="button" disabled={!filteredRecords.length} onClick={download}>Export Filtered CSV</button>
        </aside>
      </section>
      {selectedSaleId && <TransactionDetailsModal saleId={selectedSaleId} onClose={() => setSelectedSaleId(null)} />}
    </>
  )
}

export default RevenueReport
import PageSkeleton from '../Shared/PageSkeleton.jsx'
