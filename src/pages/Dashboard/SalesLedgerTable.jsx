import DataTable from '../Shared/DataTable.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import { salesLedger } from '../../data/sales.js'
import { peso } from '../../utils/currency.js'

const columns = [
  'Receipt Ref',
  'Billing Date',
  'Partner Store',
  'Billing Terms',
  'Invoiced Amount',
  'Balance Outstanding',
  'Order Status',
]

function SalesLedgerTable() {
  return (
    <article className="panel table-panel">
      <h2>SALES OPERATIONS JOURNAL LEDGER</h2>
      <DataTable
        columns={columns}
        rows={salesLedger}
        renderRow={(row) => (
          <tr key={row[0]}>
            <td>{row[0]}</td>
            <td>{row[1]}</td>
            <td>{row[2]}</td>
            <td>{row[3]}</td>
            <td>{peso.format(row[4])}</td>
            <td>{peso.format(row[5])}</td>
            <td>
              <StatusBadge value={row[6]} />
            </td>
          </tr>
        )}
      />
    </article>
  )
}

export default SalesLedgerTable
