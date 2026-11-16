import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '../../hooks/useAuth.js'
import {
  archiveUser,
  createUser,
  getUsers,
  resendEmailVerification,
  resetUserPassword,
  restoreUser,
  updateUser,
} from '../../services/userService.js'
import EmptyState from '../Shared/EmptyState.jsx'
import Modal from '../Shared/Modal.jsx'
import PageSkeleton from '../Shared/PageSkeleton.jsx'
import ArchivedUserPanel from './ArchivedUserPanel.jsx'
import UserForm from './UserForm.jsx'
import UserStats from './UserStats.jsx'
import UserTable from './UserTable.jsx'
import { useToast } from '../../context/ToastContext.jsx'

function UserAccounts() {
  const { user: currentUser } = useAuth()
  const { showSuccess, showError, showWarning } = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('create')
  const [selectedUser, setSelectedUser] = useState(null)
  const [busy, setBusy] = useState(false)
  const [verificationBusyId, setVerificationBusyId] = useState(null)
  const [showArchivedPanel, setShowArchivedPanel] = useState(false)
  const [userToArchive, setUserToArchive] = useState(null)
  const [userToRestore, setUserToRestore] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const statusLock = useRef(false)
  const verificationLock = useRef(false)

  const activeUsers = useMemo(() => users.filter((user) => Boolean(user.is_active)), [users])
  const archivedUsers = useMemo(() => users.filter((user) => !user.is_active), [users])

  async function loadUsers() {
    try {
      const data = await getUsers()
      setUsers(data)
      setError('')
    } catch (requestError) {
      setError(requestError.message || 'Unable to load user accounts')
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    getUsers({ signal: controller.signal })
      .then(setUsers)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  function choose(nextMode, user = null) {
    setMode(nextMode)
    setSelectedUser(user)
  }

  async function submit(form) {
    setBusy(true)
    try {
      let result
      if (mode === 'create') {
        result = await createUser({
          fullname: form.fullname,
          username: form.username,
          email: form.email,
          contact_number: form.contact_number,
          password: form.password,
          role: form.role,
        })
      } else if (mode === 'edit') {
        result = await updateUser(selectedUser.user_id, {
          fullname: form.fullname,
          username: form.username,
          email: form.email,
          contact_number: form.contact_number,
          role: form.role,
        })
      } else {
        result = await resetUserPassword(selectedUser.user_id, form.password)
      }
      choose('create')
      showSuccess(result.message)
      try {
        await loadUsers()
      } catch (refreshError) {
        showWarning(`Saved, but the user list could not be refreshed: ${refreshError.message}`)
      }
    } catch (requestError) {
      showError(requestError.message || 'Unable to save user account')
      throw requestError
    } finally {
      setBusy(false)
    }
  }

  async function archiveSelectedUser(user) {
    if (statusLock.current) return
    statusLock.current = true
    setActionBusy(true)
    setActionError('')
    try {
      const result = await archiveUser(user.user_id)
      showSuccess(result.message || `${user.fullname} was archived. Login access has been revoked.`)
      setUserToArchive(null)
      await loadUsers()
    } catch (requestError) {
      const msg = requestError.message || 'Unable to archive user account'
      showError(msg)
      setActionError(msg)
    } finally {
      statusLock.current = false
      setActionBusy(false)
    }
  }

  async function restoreSelectedUser(user) {
    if (statusLock.current) return
    statusLock.current = true
    setActionBusy(true)
    setActionError('')
    try {
      const result = await restoreUser(user.user_id)
      showSuccess(result.message || `${user.fullname} was restored. Login access has been reactivated.`)
      setUserToRestore(null)
      await loadUsers()
    } catch (requestError) {
      const msg = requestError.message || 'Unable to restore user account'
      showError(msg)
      setActionError(msg)
    } finally {
      statusLock.current = false
      setActionBusy(false)
    }
  }

  async function sendVerification(user) {
    if (verificationLock.current) return
    verificationLock.current = true
    setVerificationBusyId(user.user_id)
    setError('')
    try {
      const result = await resendEmailVerification(user.user_id)
      showSuccess(result.message)
    } catch (requestError) {
      showError(requestError.message || 'Unable to send verification email')
      setError(requestError.message)
    } finally {
      verificationLock.current = false
      setVerificationBusyId(null)
    }
  }

  if (loading) return <PageSkeleton variant="users" label="user accounts" />

  return (
    <section className="users-layout">
      <div className="full-span user-feedback-stack">
        {error && users.length > 0 && (
          <div className="users-feedback error" role="alert">
            {error}
          </div>
        )}
      </div>

      <UserStats
        users={activeUsers}
        archivedUsers={archivedUsers}
        onShowArchived={() => setShowArchivedPanel(true)}
      />

      {!users.length && error ? (
        <EmptyState>{error}</EmptyState>
      ) : (
        <UserTable
          users={activeUsers}
          archivedCount={archivedUsers.length}
          currentUserId={currentUser?.user_id}
          onEdit={(user) => choose('edit', user)}
          onResetPassword={(user) => choose('password', user)}
          onArchive={(user) => {
            setUserToArchive(user)
            setActionError('')
          }}
          onShowArchived={() => setShowArchivedPanel(true)}
          onSendVerification={sendVerification}
          verificationBusyId={verificationBusyId}
        />
      )}

      <UserForm
        key={`${mode}-${selectedUser?.user_id || 'new'}`}
        mode={mode}
        selectedUser={selectedUser}
        protectAdminRole={
          mode === 'edit' && Number(selectedUser?.user_id) === Number(currentUser?.user_id)
        }
        onCancel={() => choose('create')}
        onSubmit={submit}
        busy={busy}
      />

      {/* Archive User Confirmation Modal */}
      {userToArchive && (
        <Modal
          title="Archive User Account"
          onClose={() => {
            if (!actionBusy) setUserToArchive(null)
          }}
          className="user-confirmation-modal"
        >
          <p>
            Are you sure you want to archive <strong>{userToArchive.fullname}</strong> (@
            {userToArchive.username})?
          </p>
          <p className="user-confirmation-subtext">
            Archiving revokes sign-in access immediately. All historical sales, activities, and audit
            records remain preserved. You can restore this account at any time from the Archived
            Users drawer.
          </p>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="user-confirmation-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => setUserToArchive(null)}
              disabled={actionBusy}
            >
              Cancel
            </button>
            <button
              className="primary-action danger"
              type="button"
              onClick={() => archiveSelectedUser(userToArchive)}
              disabled={actionBusy}
            >
              {actionBusy ? 'Archiving...' : 'Confirm Archive'}
            </button>
          </div>
        </Modal>
      )}

      {/* Restore User Confirmation Modal */}
      {userToRestore && (
        <Modal
          title="Restore User Account"
          onClose={() => {
            if (!actionBusy) setUserToRestore(null)
          }}
          className="user-confirmation-modal"
          backdropClassName="archive-panel-confirmation-backdrop"
        >
          <p>
            Restore <strong>{userToRestore.fullname}</strong> (@{userToRestore.username}) to active
            inventory and system access?
          </p>
          <p className="user-confirmation-subtext">
            Restoring this account reactivates sign-in access so the user can log in and perform
            role-authorized actions once again.
          </p>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="user-confirmation-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => setUserToRestore(null)}
              disabled={actionBusy}
            >
              Cancel
            </button>
            <button
              className="primary-action"
              type="button"
              onClick={() => restoreSelectedUser(userToRestore)}
              disabled={actionBusy}
            >
              {actionBusy ? 'Restoring...' : 'Confirm Restore'}
            </button>
          </div>
        </Modal>
      )}

      {/* Archived Users Slide-Over Drawer */}
      <AnimatePresence>
        {showArchivedPanel && (
          <ArchivedUserPanel
            users={archivedUsers}
            loading={false}
            error=""
            onClose={() => setShowArchivedPanel(false)}
            onRestore={(user) => {
              setUserToRestore(user)
              setActionError('')
            }}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

export default UserAccounts
