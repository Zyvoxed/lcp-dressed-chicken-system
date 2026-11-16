import { Archive, KeyRound, MailCheck, Pencil, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'

const columns = ['Full Name', 'Username', 'Recovery Email', 'Contact Number', 'Role', 'Status', 'Actions']
const sortAccessors = [
  (user) => user.fullname,
  (user) => user.username,
  (user) => user.email || '',
  (user) => user.contact_number || '',
  (user) => user.role,
  (user) => (user.is_active ? 'Active' : 'Archived'),
  () => '',
]

function UserTable({
  users,
  archivedCount = 0,
  currentUserId,
  onEdit,
  onResetPassword,
  onArchive,
  onShowArchived,
  onSendVerification,
  verificationBusyId,
}) {
  const [roleFilter, setRoleFilter] = useState('All')
  const [query, setQuery] = useState('')

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter(
      (user) =>
        (roleFilter === 'All' || user.role === roleFilter) &&
        (!needle ||
          [user.fullname, user.username, user.email, user.contact_number].some((value) =>
            String(value || '').toLowerCase().includes(needle)
          ))
    )
  }, [query, roleFilter, users])

  return (
    <article className="panel user-registry-panel">
      <header className="user-registry-header">
        <div className="user-registry-title-row">
          <div className="user-registry-title-wrap">
            <h2>USER ACCOUNTS</h2>
            <span className="user-registry-count" aria-live="polite">
              {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
            </span>
          </div>

          <div className="user-registry-header-actions">
            <button
              className="secondary-action slim user-archived-trigger"
              type="button"
              onClick={onShowArchived}
            >
              <Archive size={14} aria-hidden="true" />
              <span>Archived Users</span>
              {archivedCount > 0 && <span className="user-archived-badge">{archivedCount}</span>}
            </button>
          </div>
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

          return (
            <tr key={user.user_id}>
              <td>
                <div className="user-identity">
                  <strong>{user.fullname}</strong>
                  {current && <b className="user-current-pill">YOU</b>}
                  <span>UID: usr-{user.user_id}</span>
                </div>
              </td>
              <td>
                <strong className="secure-username">{user.username}</strong>
              </td>
              <td>
                <div className="user-email">
                  <span>{user.email || '—'}</span>
                  {user.email && (
                    <b className={user.email_verified_at ? 'verified' : 'unverified'}>
                      {user.email_verified_at ? 'VERIFIED' : 'UNVERIFIED'}
                    </b>
                  )}
                </div>
              </td>
              <td>{user.contact_number || '—'}</td>
              <td>
                <span className={`user-role-badge ${String(user.role).toLowerCase()}`}>{user.role}</span>
              </td>
              <td>
                <StatusBadge value={user.is_active ? 'Active' : 'Archived'} />
              </td>
              <td>
                <div className="user-table-actions">
                  <button
                    className="table-action"
                    type="button"
                    onClick={() => onEdit(user)}
                    title={`Edit ${user.fullname}`}
                  >
                    <Pencil size={12} aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                  <button
                    className="table-action"
                    type="button"
                    onClick={() => onResetPassword(user)}
                    title={`Reset password for ${user.fullname}`}
                  >
                    <KeyRound size={12} aria-hidden="true" />
                    <span>Reset</span>
                  </button>
                  {user.email && !user.email_verified_at && (
                    <button
                      className="table-action"
                      type="button"
                      onClick={() => onSendVerification(user)}
                      disabled={verificationBusyId === user.user_id}
                      aria-busy={verificationBusyId === user.user_id}
                      title="Resend email verification link"
                    >
                      {verificationBusyId === user.user_id ? (
                        <>
                          <span className="user-action-spinner" aria-hidden="true" />
                          <span>Sending</span>
                        </>
                      ) : (
                        <>
                          <MailCheck size={12} aria-hidden="true" />
                          <span>Verify</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    className="table-action danger"
                    type="button"
                    disabled={current}
                    title={current ? 'You cannot archive your own account' : `Archive ${user.fullname}`}
                    onClick={() => onArchive(user)}
                  >
                    <Archive size={12} aria-hidden="true" />
                    <span>Archive</span>
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
