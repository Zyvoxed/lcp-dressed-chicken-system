import UserForm from './UserForm.jsx'
import UserStats from './UserStats.jsx'
import UserTable from './UserTable.jsx'

function UserAccounts() {
  return (
    <section className="users-layout">
      <UserStats />
      <UserTable />
      <UserForm />
    </section>
  )
}

export default UserAccounts
