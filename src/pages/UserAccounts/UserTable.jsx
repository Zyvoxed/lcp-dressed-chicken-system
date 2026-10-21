import { KeyRound, MailCheck, Pencil, Power, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'

const columns = ['Full Name', 'Username', 'Recovery Email', 'Contact Number', 'Role', 'Status', 'Actions']
const sortAccessors = [
  (user) => user.fullname,
  (user) => user.username,
  (user) => user.email,
  (user) => user.contact_number,
  (user) => user.role,
  (user) => user.is_active,
  () => '',
]

function UserTable({ users, currentUserId, onEdit, onResetPassword, onToggleStatus, onSendVerification, busyId, verificationBusyId }) {
  const [roleFilter, setRoleFilter] = useState('All')
  const [query, setQuery] = useState('')
  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) => (roleFilter === 'All' || user.role === roleFilter) && (!needle || [user.fullname, user.username, user.email, user.contact_number].some((value) => String(value || '').toLowerCase().includes(needle))))
  }, [query, roleFilter, users])

  return (
    <article className="panel user-registry-panel">
      <header className="user-registry-header">
        <div>
          <h2>USER ACCOUNTS</h2>
          <p>{filteredUsers.length} users found</p>
        </div>
        <div className="user-registry-controls">
          <div className="user-role-filter" role="group" aria-label="Filter accounts by role">
            {['All', 'Admin', 'Staff'].map((role) => (
              <button
                className={roleFilter === role ? 'active' : ''}
                type="button"
                aria-pressed={roleFilter === role}
                onClick={() => setRoleFilter(role)}
                key={role}
              >
                {role}
              </button>
            ))}
          </div>
          <label className="user-registry-search">
            <Search size={15} aria-hidden="true" />
            <input
              aria-label="Search user accounts"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, username, email or phone"
            />
          </label>
        </div>
      </header>
      <DataTable
        columns={columns}
        rows={filteredUsers}
        searchable={false}
        getSortValue={(user, columnIndex) => sortAccessors[columnIndex](user)}
        renderRow={(user) => {
          const current = Number(user.user_id) === Number(currentUserId)
          const updating = busyId === user.user_id

          return (
            <tr className={!user.is_active ? 'inactive-user-row' : ''} key={user.user_id}>
              <td>
                <div className="user-identity">
                  <strong>{user.fullname}</strong>
                  {current && <b>YOUR ACCOUNT</b>}
                  <span>UID: usr-{user.user_id}</span>
                </div>
              </td>
              <td><strong className="secure-username">{user.username}</strong></td>
              <td>
                <div className="user-email">
                  <span>{user.email || '—'}</span>
                  {user.email && <b className={user.email_verified_at ? 'verified' : 'unverified'}>{user.email_verified_at ? 'VERIFIED' : 'UNVERIFIED'}</b>}
                </div>
              </td>
              <td>{user.contact_number || '—'}</td>
              <td><span className={`user-role-badge ${user.role.toLowerCase()}`}>{user.role}</span></td>
              <td><span className={`user-status-badge ${user.is_active ? 'active' : 'inactive'}`}>{user.is_active ? 'Active' : 'Inactive'}</span></td>
              <td>
                <div className="user-table-actions">
                  <button className="table-action" type="button" onClick={() => onEdit(user)}>
                    <Pencil size={12} aria-hidden="true" />Edit
                  </button>
                  <button className="table-action" type="button" onClick={() => onResetPassword(user)}>
                    <KeyRound size={12} aria-hidden="true" />Reset
                  </button>
                  {user.email && !user.email_verified_at && (
                    <button className="table-action" type="button" onClick={() => onSendVerification(user)} disabled={verificationBusyId === user.user_id} aria-busy={verificationBusyId === user.user_id}>
                      {verificationBusyId === user.user_id
                        ? <><span className="user-action-spinner" aria-hidden="true" />Sending</>
                        : <><MailCheck size={12} aria-hidden="true" />Send Verification</>}
                    </button>
                  )}
                  <button
                    className={`table-action ${user.is_active ? 'danger' : 'success'}`}
                    type="button"
                    disabled={updating || (current && user.is_active)}
                    aria-busy={updating}
                    title={current && user.is_active ? 'You cannot deactivate your own account' : ''}
                    onClick={() => onToggleStatus(user)}
                  >
                    {updating
                      ? <><span className="user-action-spinner" aria-hidden="true" />Updating</>
                      : <><Power size={12} aria-hidden="true" />{user.is_active ? 'Deactivate' : 'Reactivate'}</>}
                  </button>
                </div>
              </td>
            </tr>
          )
        }}
      />
    </article>
  )
}
export default UserTable
