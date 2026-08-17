import { useEffect, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import ReportMetrics from './ReportMetrics.jsx'
import { getSalesReport, logReportExport } from '../../services/reportService.js'
import { exportCsv } from '../../utils/csvExport.js'
import { peso } from '../../utils/currency.js'

function RevenueReport() {
  const [filters, setFilters] = useState({ start_date: '', end_date: '', payment_type: '' })
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadReport(activeFilters = filters) {
    setLoading(true)
    setError('')
    try { setReport(await getSalesReport(activeFilters)) }
    catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let active = true
    getSalesReport().then((data) => { if (active) setReport(data) }).catch((requestError) => { if (active) setError(requestError.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function download() {
    try { await logReportExport('Sales & Revenue') } catch (logError) { console.error(logError.message) }
    exportCsv(`sales-report-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Sale ID', 'Date', 'Customer', 'Recorded By', 'Payment Type', 'Total Amount', 'Amount Paid', 'Remaining Balance', 'Status'],
      report.records.map((sale) => [sale.sale_id, sale.sale_date, sale.customer_name, sale.recorded_by, sale.payment_type, sale.total_amount, sale.amount_paid, sale.remaining_balance, sale.status]))
  }

  if (loading) return <LoadingSpinner />
  if (error) return <EmptyState>{error}</EmptyState>
  if (!report) return <EmptyState>No sales report data found.</EmptyState>

  return (
    <>
      <ReportMetrics summary={report.summary} />
      <section className="report-layout">
        <article className="panel table-panel">
          <h2>SALES & REVENUE AUDIT</h2>
          {!report.records.length ? <EmptyState>No sales transactions match the filters.</EmptyState> : <DataTable
            columns={['Sale ID', 'Date', 'Customer', 'Recorded By', 'Payment Type', 'Total', 'Paid', 'Balance', 'Status']}
            rows={report.records}
            getSortValue={(sale, index) => [sale.sale_id, sale.sale_date, sale.customer_name, sale.recorded_by, sale.payment_type, Number(sale.total_amount), Number(sale.amount_paid), Number(sale.remaining_balance), sale.status][index]}
            renderRow={(sale) => <tr key={sale.sale_id}><td>OR-{sale.sale_id}</td><td>{new Date(sale.sale_date).toLocaleString()}</td><td>{sale.customer_name}</td><td>{sale.recorded_by}</td><td>{sale.payment_type}</td><td>{peso.format(Number(sale.total_amount))}</td><td>{peso.format(Number(sale.amount_paid))}</td><td>{peso.format(Number(sale.remaining_balance))}</td><td>{sale.status}</td></tr>}
          />}
        </article>
        <aside className="receipt-panel">
          <h2>Report Filters</h2>
          <label>Start Date<input type="date" value={filters.start_date} onChange={(event) => setFilters((current) => ({ ...current, start_date: event.target.value }))} /></label>
          <label>End Date<input type="date" value={filters.end_date} onChange={(event) => setFilters((current) => ({ ...current, end_date: event.target.value }))} /></label>
          <label>Payment Type<select value={filters.payment_type} onChange={(event) => setFilters((current) => ({ ...current, payment_type: event.target.value }))}><option value="">All</option><option value="Cash">Cash</option><option value="Credit">Credit</option></select></label>
          <strong>{report.summary.total_transactions} transactions</strong>
          <button className="secondary-action" type="button" onClick={() => loadReport()}>Generate Report</button>
          <button className="primary-action" type="button" onClick={download}>Export CSV</button>
        </aside>
      </section>
    </>
  )
}

export default RevenueReport
