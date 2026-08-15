import DataTable from '../Shared/DataTable.jsx'
import { users } from '../../data/users.js'

const columns = ['Operator Full Name', 'Username', 'Phone', 'Role', 'Actions']

function UserTable() {
  return (
    <article className="panel table-panel">
      <h2>USER ACCOUNTS</h2>
      <DataTable
        columns={columns}
        rows={users}
        renderRow={(user) => (
          <tr key={user[1]}>
            <td>{user[0]}</td>
            <td>{user[1]}</td>
            <td>{user[2]}</td>
            <td>{user[3]}</td>
            <td>
              <button className="table-action" type="button">
                Edit
              </button>
              <button className="table-action danger" type="button">
                Delete
              </button>
            </td>
          </tr>
        )}
      />
    </article>
  )
}

export default UserTable
