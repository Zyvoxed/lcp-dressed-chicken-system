import { useEffect, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import BatchDetailsModal from './BatchDetailsModal.jsx'
import { getStockInRecords } from '../../services/stockInService.js'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

const columns = [
  'Delivery No.',
  'Supplier Name',
  'Product',
  'Delivery Date',
  'Stock Added',
  'Stock Remaining',
  'Stock Sold / Deducted',
  'Status',
  'Cost Per Unit',
  'Total Cost',
  'Recorded By',
  'Details',
]

const sortAccessors = [
  (record) => record.stockin_id,
  (record) => record.supplier_name,
  (record) => record.product_name,
  (record) => record.delivery_date,
  (record) => Number(record.quantity_received),
  (record) => Number(record.remaining_quantity),
  (record) => consumedQuantity(record),
  (record) => batchStatus(record),
  (record) => Number(record.cost_price),
  (record) => Number(record.total_cost),
  (record) => record.recorded_by,
  () => '',
]

function consumedQuantity(record) {
  return Math.max(Number(record.quantity_received) - Number(record.remaining_quantity), 0)
}

function batchStatus(record) {
  const remaining = Number(record.remaining_quantity)
  const consumed = consumedQuantity(record)
  if (remaining <= 0) return 'Used Up'
  if (consumed > 0) return 'Partially Used'
  return 'Available'
}

function formatQuantity(value) {
  return Number(value).toLocaleString('en-PH', { maximumFractionDigits: 3 })
}

function InflowRecords() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedBatch, setSelectedBatch] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadRecords() {
      try {
        setRecords(await getStockInRecords({ signal: controller.signal }))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') {
          setError(requestError.message)
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    loadRecords()

    return () => controller.abort()
  }, [])

  return (
    <>
      <article className="panel table-panel inventory-inflow-table">
        <div className="inventory-inflow-heading">
          <div>
            <h2>STOCK DELIVERY HISTORY</h2>
            <p>The system automatically uses stock from older deliveries before newer deliveries.</p>
          </div>
          {!loading && !error && <span>{records.length} batch{records.length === 1 ? '' : 'es'}</span>}
        </div>
        {loading && <LoadingSpinner />}
        {!loading && error && <EmptyState>{error}</EmptyState>}
        {!loading && !error && !records.length && <EmptyState>No stock delivery records found.</EmptyState>}
        {!loading && !error && records.length > 0 && <DataTable
          columns={columns}
          rows={records}
          searchPlaceholder="Search batches, products, or suppliers"
          getSortValue={(record, columnIndex) => sortAccessors[columnIndex](record)}
          renderRow={(record) => {
            const status = batchStatus(record)
            return (
              <tr key={record.stockin_id} className={`inventory-batch-row ${status.toLowerCase().replaceAll(' ', '-')}`}>
                <td><strong className="inventory-batch-reference">DLV-{record.stockin_id}</strong></td>
                <td>{record.supplier_name}</td>
                <td><strong className="inventory-batch-product">{record.product_name}</strong></td>
                <td><time dateTime={record.delivery_date}>{formatActivityTimestamp(record.delivery_date).dateTime}</time></td>
                <td>{formatQuantity(record.quantity_received)} {record.unit}</td>
                <td><strong>{formatQuantity(record.remaining_quantity)} {record.unit}</strong></td>
                <td>{formatQuantity(consumedQuantity(record))} {record.unit}</td>
                <td><StatusBadge value={status} /></td>
                <td>{peso.format(Number(record.cost_price))}</td>
                <td>{peso.format(Number(record.total_cost))}</td>
                <td>{record.recorded_by}</td>
                <td><button className="table-action" type="button" onClick={() => setSelectedBatch(record)} aria-label={`View FIFO details for batch DLV-${record.stockin_id}`}>View Details</button></td>
              </tr>
            )
          }}
        />}
      </article>
      {selectedBatch && <BatchDetailsModal batch={selectedBatch} onClose={() => setSelectedBatch(null)} />}
    </>
  )
}

export default InflowRecords
