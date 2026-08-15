import DataTable from '../Shared/DataTable.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'
import SearchBar from '../Shared/SearchBar.jsx'
import { debtors } from '../../data/customers.js'
import { peso } from '../../utils/currency.js'

const columns = ['Business Name', 'Phone', 'Address', 'Outstanding Balance', 'Status']

function ReceivablesLedger() {
  return (
    <article className="panel table-panel">
      <div className="panel-title-row">
        <h2>CREDIT RECEIVABLES LEDGER</h2>
        <SearchBar className="search-input narrow" placeholder="Search ledger" />
      </div>
      <DataTable
        columns={columns}
        rows={debtors}
        renderRow={(row) => (
          <tr key={row[0]}>
            <td>{row[0]}</td>
            <td>{row[1]}</td>
            <td>{row[2]}</td>
            <td className="highlight-money">{peso.format(row[3])}</td>
            <td>
              <StatusBadge value={row[4]} />
            </td>
          </tr>
        )}
      />
    </article>
  )
}

export default ReceivablesLedger
