import { Archive, RotateCcw, X } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import DataTable from '../Shared/DataTable.jsx'
import EmptyState from '../Shared/EmptyState.jsx'
import StatusBadge from '../Shared/StatusBadge.jsx'

function ArchivedUserPanel({ users, loading, error, onClose, onRestore }) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className="user-archived-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.aside
        className="user-archived-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-archived-title"
        initial={{ x: reduceMotion ? 0 : '100%' }}
        animate={{ x: 0 }}
        exit={{ x: reduceMotion ? 0 : '100%' }}
        transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="user-archived-header">
          <div className="user-archived-heading">
            <span className="user-archived-icon">
              <Archive size={18} aria-hidden="true" />
            </span>
            <div>
              <p className="user-archived-kicker">User records</p>
              <h2 id="user-archived-title">Archived user accounts</h2>
              <p className="user-archived-description">
                Review archived accounts and restore login access when needed.
              </p>
            </div>
          </div>
          <button
            className="close-button"
            type="button"
            onClick={onClose}
            aria-label="Close archived users panel"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          <div className="loading-state" role="status">
            <i aria-hidden="true" /> Loading archived user accounts…
          </div>
        ) : error ? (
          <EmptyState>{error}</EmptyState>
        ) : !users.length ? (
          <EmptyState>No archived user accounts found.</EmptyState>
        ) : (
          <div className="user-archived-table">
            <DataTable
              columns={['User', 'Username', 'Recovery Email', 'Contact', 'Role', 'Status', 'Action']}
              rows={users}
              pageSize={8}
              searchPlaceholder="Search archived users"
              getSortValue={(user, columnIndex) => [
                user.fullname,
                user.username,
                user.email || '',
                user.contact_number || '',
                user.role,
                'Archived',
                '',
              ][columnIndex] ?? ''}
              renderRow={(user) => (
                <tr key={user.user_id}>
                  <td>
                    <div className="user-archived-name">
                      <strong>{user.fullname}</strong>
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
                    <span className={`user-role-badge ${String(user.role).toLowerCase()}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>
                    <StatusBadge value="Archived" />
                  </td>
                  <td>
                    <button
                      className="secondary-action slim user-archived-restore"
                      type="button"
                      onClick={() => onRestore(user)}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      <span>Restore</span>
                    </button>
                  </td>
                </tr>
              )}
            />
          </div>
        )}
      </motion.aside>
    </motion.div>
  )
}

export default ArchivedUserPanel
