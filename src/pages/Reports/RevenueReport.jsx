import SalesLedgerTable from '../Dashboard/SalesLedgerTable.jsx'
import ReportMetrics from './ReportMetrics.jsx'
import { receipt } from '../../data/reports.js'
import { peso } from '../../utils/currency.js'

function RevenueReport() {
  return (
    <>
      <ReportMetrics />
      <section className="report-layout">
        <SalesLedgerTable />
        <aside className="receipt-panel">
          <h2>Receipt Inspector</h2>
          <p>{receipt.ref}</p>
          <strong>{receipt.customer}</strong>
          <span>{receipt.line}</span>
          <b>{peso.format(receipt.amount)}</b>
          <button className="primary-action" type="button">
            Export Billet Slip
          </button>
        </aside>
      </section>
    </>
  )
}

export default RevenueReport
