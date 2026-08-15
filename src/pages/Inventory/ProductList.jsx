import DataTable from '../Shared/DataTable.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { inventoryRows } from '../../data/products.js'
import { peso } from '../../utils/currency.js'

const columns = [
  'Product Name',
  'Category',
  'Selling Price',
  'In Stock Level',
  'Reorder Threshold',
  'Status',
  'Actions',
]

function ProductList() {
  return (
    <DataTable
      columns={columns}
      rows={inventoryRows}
      renderRow={(row) => (
        <tr key={row[0]}>
          <td>{row[0]}</td>
          <td>{row[1]}</td>
          <td>{peso.format(row[2])}</td>
          <td>{row[3]}</td>
          <td>{row[4]}</td>
          <td>
            <StatusBadge value={row[5]} />
          </td>
          <td>
            <button className="table-action" type="button">
              Edit
            </button>
          </td>
        </tr>
      )}
    />
  )
}

export default ProductList
