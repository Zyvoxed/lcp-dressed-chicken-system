import { useEffect, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
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
]

const sortAccessorMap = {
  'Delivery No.': (record) => record.stockin_id,
  'Supplier Name': (record) => record.supplier_name,
  'Product': (record) => record.product_name,
  'Delivery Date': (record) => record.delivery_date,
  'Stock Added': (record) => Number(record.quantity_received),
  'Stock Remaining': (record) => Number(record.remaining_quantity),
  'Stock Sold / Deducted': (record) => consumedQuantity(record),
  'Status': (record) => batchStatus(record),
  'Cost Per Unit': (record) => Number(record.cost_price),
  'Total Cost': (record) => Number(record.total_cost),
  'Recorded By': (record) => record.recorded_by,
}

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

function InflowRecords({ staffView = false }) {
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

  const visibleColumns = staffView
    ? columns
      .filter((column) => !['Cost Per Unit', 'Total Cost'].includes(column))
      .map((column) => (column === 'Stock Sold / Deducted' ? 'Stock Sold' : column))
    : columns

  return (
    <>
      <article className={`panel table-panel inventory-inflow-table ${staffView ? 'staff-inventory-inflow-table' : ''}`}>
        <div className="inventory-inflow-heading">
          <h2>STOCK DELIVERY HISTORY</h2>
          {!loading && !error && !staffView && <span>{records.length} batch{records.length === 1 ? '' : 'es'}</span>}
        </div>
        {loading && <PageSkeleton variant="inventory-inflow" label="inflow records" />}
        {!loading && error && <EmptyState>{error}</EmptyState>}
        {!loading && !error && !records.length && <EmptyState>No stock delivery records found.</EmptyState>}
        {!loading && !error && records.length > 0 && <DataTable
          columns={visibleColumns}
          rows={records}
          pageSize={staffView ? 20 : 10}
          searchPlaceholder="Search batches, products, or suppliers"
          toolbarContent={staffView && (
            <span className="staff-inventory-batch-count" aria-live="polite">
              {records.length} {records.length === 1 ? 'batch' : 'batches'}
            </span>
          )}
          nonSortableColumns={staffView ? visibleColumns : []}
          getSortValue={(record, columnIndex) => {
            const col = visibleColumns[columnIndex]
            return sortAccessorMap[col] ? sortAccessorMap[col](record) : ''
          }}
          renderRow={(record) => {
            const status = batchStatus(record)
            return (
              <tr
                key={record.stockin_id}
                className={`inventory-batch-row ${status.toLowerCase().replaceAll(' ', '-')}`}
                tabIndex={staffView ? -1 : 0}
                aria-label={staffView ? `Stock-in receipt DLV-${record.stockin_id}` : `Open delivery details for DLV-${record.stockin_id}`}
                aria-haspopup={staffView ? undefined : 'dialog'}
                onClick={() => { if (!staffView) setSelectedBatch(record) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    if (!staffView) setSelectedBatch(record)
                  }
                }}
              >
                <td><strong className="inventory-batch-reference">DLV-{record.stockin_id}</strong></td>
                <td>{record.supplier_name}</td>
                <td><strong className="inventory-batch-product">{record.product_name}</strong></td>
                <td><time dateTime={record.delivery_date}>{formatActivityTimestamp(record.delivery_date).dateTime}</time></td>
                <td>{formatQuantity(record.quantity_received)} {record.unit}</td>
                <td><strong>{formatQuantity(record.remaining_quantity)} {record.unit}</strong></td>
                <td>{formatQuantity(consumedQuantity(record))} {record.unit}</td>
                <td><StatusBadge value={status} /></td>
                {!staffView && <td>{peso.format(Number(record.cost_price))}</td>}
                {!staffView && <td>{peso.format(Number(record.total_cost))}</td>}
                <td>{record.recorded_by}</td>
              </tr>
            )
          }}
        />}
      </article>
      {!staffView && selectedBatch && <BatchDetailsModal batch={selectedBatch} onClose={() => setSelectedBatch(null)} />}
    </>
  )
}

export default InflowRecords
