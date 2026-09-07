import EmptyState from '../Shared/EmptyState.jsx'
import { formatLocalDate } from '../../utils/dateFormatter.js'

function SupplierLedger({ records }) {
  return (
    <article className="panel">
      <h2>Historical Procurement Ledger</h2>
      {!records.length ? <EmptyState>No stock-in deliveries recorded.</EmptyState> : records.slice(0, 8).map((record) => (
        <div className="shipment-row" key={record.stockin_id}>
          <strong>{record.product_name} — {Number(record.quantity_received)} {record.unit}</strong>
          <p>{record.supplier_name} · {formatLocalDate(new Date(record.delivery_date))}</p>
        </div>
      ))}
    </article>
  )
}

export default SupplierLedger
