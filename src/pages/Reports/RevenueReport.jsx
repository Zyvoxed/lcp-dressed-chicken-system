import { useEffect, useMemo, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import ReportMetrics from './ReportMetrics.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import TransactionDetailsModal from './TransactionDetailsModal.jsx'
import { getSalesReport, logReportExport } from '../../services/reportService.js'
import { exportCsv, manilaDateStamp } from '../../utils/csvExport.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

const emptyFilters = { start_date: '', end_date: '', payment_type: '' }

function RevenueReport() {
  const [filters, setFilters] = useState(emptyFilters)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [selectedSaleId, setSelectedSaleId] = useState(null)

  async function loadReport(activeFilters = filters) {
    setLoading(true)
    setError('')
    try {
      setReport(await getSalesReport(activeFilters))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    getSalesReport({}, { signal: controller.signal })
      .then(setReport)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const filteredRecords = useMemo(() => {
    if (!report) return []
    const normalizedQuery = query.trim().toLowerCase()
    return report.records.filter((sale) => {
      const matchesStatus = !status || sale.status === status
      const searchable = [
        sale.sale_id,
        `OR-${sale.sale_id}`,
        sale.customer_name,
        sale.recorded_by,
        sale.payment_type,
        sale.status,
      ].join(' ').toLowerCase()
      return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [query, report, status])

  async function download() {
    try { await logReportExport('Sales & Revenue') } catch (logError) { console.error(logError.message) }
    exportCsv(
      `sales-report-${manilaDateStamp()}.csv`,
      ['Sale ID', 'Date', 'Customer', 'Recorded By', 'Payment Type', 'Total Amount', 'Amount Paid', 'Remaining Balance', 'Status'],
      filteredRecords.map((sale) => [`OR-${sale.sale_id}`, formatActivityTimestamp(sale.sale_date).dateTime, sale.customer_name, sale.recorded_by, sale.payment_type, sale.total_amount, sale.amount_paid, sale.remaining_balance, sale.status]),
    )
  }

  function resetFilters() {
    setFilters(emptyFilters)
    setQuery('')
    setStatus('')
    loadReport(emptyFilters)
  }

  if (loading && !report) return <div className="panel report-state-panel"><LoadingSpinner /></div>
  if (error && !report) return <div className="panel report-state-panel"><EmptyState>{error}</EmptyState><button className="secondary-action slim" type="button" onClick={() => loadReport(emptyFilters)}>Try Again</button></div>
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
            <span className="report-result-count" aria-live="polite">{filteredRecords.length} of {report.records.length} transactions</span>
          </div>

          <div className="report-local-filters" aria-label="Transaction search and status filters">
            <label>Search transactions<input type="search" value={query} placeholder="Transaction ID or customer" onChange={(event) => setQuery(event.target.value)} /></label>
            <label>Payment Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="Paid">Paid</option><option value="Partially Paid">Partially Paid</option><option value="Unpaid">Unpaid</option></select></label>
          </div>

          {error && <p className="report-inline-error" role="alert">{error}</p>}
          {!report.records.length ? <EmptyState>No sales transactions match the report filters.</EmptyState> : <DataTable
            columns={['Sale ID', 'Date', 'Customer', 'Recorded By', 'Payment Type', 'Total', 'Paid', 'Balance', 'Status']}
            rows={filteredRecords}
            searchable={false}
            getSortValue={(sale, index) => [sale.sale_id, sale.sale_date, sale.customer_name, sale.recorded_by, sale.payment_type, Number(sale.total_amount), Number(sale.amount_paid), Number(sale.remaining_balance), sale.status][index]}
            renderRow={(sale) => <tr key={sale.sale_id}>
              <td><button className="report-transaction-link" type="button" onClick={() => setSelectedSaleId(sale.sale_id)} aria-label={`View transaction OR-${sale.sale_id}`}>OR-{sale.sale_id}</button></td>
              <td><time dateTime={sale.sale_date}>{formatActivityTimestamp(sale.sale_date).dateTime}</time></td>
              <td>{sale.customer_name}</td><td>{sale.recorded_by}</td><td>{sale.payment_type}</td>
              <td>{peso.format(Number(sale.total_amount))}</td><td>{peso.format(Number(sale.amount_paid))}</td><td>{peso.format(Number(sale.remaining_balance))}</td><td><StatusBadge value={sale.status} /></td>
            </tr>}
          />}
        </article>
        <aside className="receipt-panel report-filter-panel">
          <div className="report-heading report-filter-heading"><h2>Report Filters</h2><p>Apply date and payment-type limits to the report dataset.</p></div>
          <label>Start Date<input type="date" value={filters.start_date} onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value }))} /></label>
          <label>End Date<input type="date" value={filters.end_date} onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value }))} /></label>
          <label>Payment Type<select value={filters.payment_type} onChange={(event) => setFilters((current) => ({ ...current, payment_type: event.target.value }))}><option value="">All payment types</option><option value="Cash">Cash</option><option value="Credit">Credit</option></select></label>
          <strong>{report.summary.total_transactions} transactions in report</strong>
          <button className="secondary-action" type="button" disabled={loading} onClick={() => loadReport()}>{loading ? 'Generating…' : 'Generate Report'}</button>
          <button className="secondary-action" type="button" disabled={loading} onClick={resetFilters}>Clear Filters</button>
          <button className="primary-action" type="button" disabled={!filteredRecords.length} onClick={download}>Export Filtered CSV</button>
        </aside>
      </section>
      {selectedSaleId && <TransactionDetailsModal saleId={selectedSaleId} onClose={() => setSelectedSaleId(null)} />}
    </>
  )
}

export default RevenueReport
