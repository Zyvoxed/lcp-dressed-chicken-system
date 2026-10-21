import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

const columns = ['Delivery', 'Supplier', 'Product', 'Quantity', 'Cost per Unit', 'Total Cost', 'Delivery Date', 'Recorded By']

function SupplierLedger({ records, loading, error }) {
  return (
    <article className="panel table-panel supplier-ledger-panel">
      <div className="supplier-panel-heading">
        <h2>Delivery History</h2>
        <p>Search, sort, and review confirmed supplier deliveries recorded through Stock In.</p>
      </div>
      {loading && <LoadingSpinner />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && !records.length && <EmptyState>No stock deliveries recorded.</EmptyState>}
      {!loading && !error && records.length > 0 && <DataTable
        columns={columns}
        rows={records}
        searchPlaceholder="Search deliveries"
        getSortValue={(record, index) => [
          record.stockin_id,
          record.supplier_name,
          record.product_name,
          Number(record.quantity_received),
          Number(record.cost_price),
          Number(record.total_cost),
          record.delivery_date,
          record.recorded_by,
        ][index]}
        renderRow={(record) => <tr key={record.stockin_id}>
          <td><strong>DLV-{record.stockin_id}</strong></td>
          <td>{record.supplier_name}</td>
          <td>{record.product_name}</td>
          <td>{Number(record.quantity_received).toLocaleString('en-PH', { maximumFractionDigits: 3 })} {record.unit}</td>
          <td>{peso.format(Number(record.cost_price))}</td>
          <td><strong className="supplier-money-value">{peso.format(Number(record.total_cost))}</strong></td>
          <td><time dateTime={record.delivery_date}>{formatActivityTimestamp(record.delivery_date).dateTime}</time></td>
          <td>{record.recorded_by}</td>
        </tr>}
      />}
    </article>
  )
}

export default SupplierLedger
