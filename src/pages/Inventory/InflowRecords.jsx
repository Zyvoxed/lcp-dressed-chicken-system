import { useEffect, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import { getStockInRecords } from '../../services/stockInService.js'
import { peso } from '../../utils/currency.js'

const columns = [
  'Delivery Ref ID',
  'Supplier Name',
  'Product Delivery Line',
  'Quantity',
  'Cost Per Unit',
  'Gross Cost',
  'Delivery Date',
  'Recorded By',
]

const sortAccessors = [
  (record) => record.stockin_id,
  (record) => record.supplier_name,
  (record) => record.product_name,
  (record) => Number(record.quantity_received),
  (record) => Number(record.cost_price),
  (record) => Number(record.total_cost),
  (record) => record.delivery_date,
  (record) => record.recorded_by,
]

function InflowRecords() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
    <article className="panel table-panel">
      <h2>SUPPLIER DELIVERY INFLOW RECORDS</h2>
      {loading && <LoadingSpinner />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && !records.length && <EmptyState>No stock-in records found.</EmptyState>}
      {!loading && !error && records.length > 0 && <DataTable
        columns={columns}
        rows={records}
        getSortValue={(record, columnIndex) => sortAccessors[columnIndex](record)}
        renderRow={(record) => (
          <tr key={record.stockin_id}>
            <td>DLV-{record.stockin_id}</td>
            <td>{record.supplier_name}</td>
            <td>{record.product_name}</td>
            <td>{Number(record.quantity_received)} {record.unit}</td>
            <td>{peso.format(Number(record.cost_price))}</td>
            <td>{peso.format(Number(record.total_cost))}</td>
            <td>{new Date(record.delivery_date).toLocaleString()}</td>
            <td>{record.recorded_by}</td>
          </tr>
        )}
      />}
    </article>
  )
}

export default InflowRecords
