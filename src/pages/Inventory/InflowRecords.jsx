import DataTable from '../Shared/DataTable.jsx'
import { inflowRows } from '../../data/sales.js'
import { peso } from '../../utils/currency.js'

const columns = [
  'Delivery Ref ID',
  'Supplier Name',
  'Product Delivery Line',
  'Quantity',
  'Cost Per Unit',
  'Gross Cost',
  'Delivery Date',
]

function InflowRecords() {
  return (
    <article className="panel table-panel">
      <h2>SUPPLIER DELIVERY INFLOW RECORDS</h2>
      <DataTable
        columns={columns}
        rows={inflowRows}
        renderRow={(row) => (
          <tr key={row[0]}>
            <td>{row[0]}</td>
            <td>{row[1]}</td>
            <td>{row[2]}</td>
            <td>{row[3]}</td>
            <td>{peso.format(row[4])}</td>
            <td>{peso.format(row[5])}</td>
            <td>{row[6]}</td>
          </tr>
        )}
      />
    </article>
  )
}

export default InflowRecords
