import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth.js'
import { createUser, getUsers, resendEmailVerification, resetUserPassword, updateUser, updateUserStatus } from '../../services/userService.js'
import EmptyState from '../Shared/EmptyState.jsx'
import Modal from '../Shared/Modal.jsx'
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
  const [busyId, setBusyId] = useState(null)
  const [verificationBusyId, setVerificationBusyId] = useState(null)
  const [pendingStatusUser, setPendingStatusUser] = useState(null)
  const [statusError, setStatusError] = useState('')
  const statusLock = useRef(false)
  const verificationLock = useRef(false)

  async function loadUsers() { setUsers(await getUsers()); setError('') }
  useEffect(() => {
    const controller = new AbortController()
    getUsers({ signal: controller.signal }).then(setUsers).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(requestError.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  function choose(nextMode, user = null) { setMode(nextMode); setSelectedUser(user) }
  async function submit(form) {
    setBusy(true)
    try {
      let result
      if (mode === 'create') result = await createUser({ fullname: form.fullname, username: form.username, email: form.email, contact_number: form.contact_number, password: form.password, role: form.role })
      else if (mode === 'edit') result = await updateUser(selectedUser.user_id, { fullname: form.fullname, username: form.username, email: form.email, contact_number: form.contact_number, role: form.role })
      else result = await resetUserPassword(selectedUser.user_id, form.password)
      choose('create')
      showSuccess(result.message)
      try { await loadUsers() } catch (refreshError) { showWarning(`Saved, but the user list could not be refreshed: ${refreshError.message}`) }
    } catch (requestError) {
      showError(requestError.message || 'Unable to save user account')
      throw requestError
    } finally { setBusy(false) }
  }
  async function toggleStatus(user) {
    if (statusLock.current) return
    statusLock.current = true
    setBusyId(user.user_id); setError(''); setStatusError('')
    try {
      const result = await updateUserStatus(user.user_id, !user.is_active)
      showSuccess(result.message)
      setPendingStatusUser(null)
      try { await loadUsers() } catch (refreshError) { showWarning(`Account status was updated, but the user list could not be refreshed: ${refreshError.message}`) }
    }
    catch (requestError) { showError(requestError.message || 'Unable to update account status'); setStatusError(requestError.message) }
    finally { statusLock.current = false; setBusyId(null) }
  }
  async function sendVerification(user) {
    if (verificationLock.current) return
    verificationLock.current = true
    setVerificationBusyId(user.user_id); setError('')
    try { const result = await resendEmailVerification(user.user_id); showSuccess(result.message) }
    catch (requestError) { showError(requestError.message || 'Unable to send verification email'); setError(requestError.message) }
    finally { verificationLock.current = false; setVerificationBusyId(null) }
  }

  if (loading) return <PageSkeleton variant="users" label="user accounts" />;
  return (
    <section className="users-layout">
      <div className="full-span user-feedback-stack">
        {error && users.length > 0 && <div className="users-feedback error" role="alert">{error}</div>}
      </div>
      <UserStats users={users} />
      {!users.length && error
        ? <EmptyState>{error}</EmptyState>
        : <UserTable users={users} currentUserId={currentUser?.user_id} onEdit={(user) => choose('edit', user)} onResetPassword={(user) => choose('password', user)} onToggleStatus={(user) => { setPendingStatusUser(user); setStatusError('') }} onSendVerification={sendVerification} busyId={busyId} verificationBusyId={verificationBusyId} />}
      <UserForm key={`${mode}-${selectedUser?.user_id || 'new'}`} mode={mode} selectedUser={selectedUser} protectAdminRole={mode === 'edit' && Number(selectedUser?.user_id) === Number(currentUser?.user_id)} onCancel={() => choose('create')} onSubmit={submit} busy={busy} />
      {pendingStatusUser && (
        <Modal
          title={`${pendingStatusUser.is_active ? 'Deactivate' : 'Activate'} Account`}
          onClose={() => { if (!busyId) setPendingStatusUser(null) }}
          className="user-confirmation-modal"
        >
          <p>{pendingStatusUser.is_active ? 'Deactivate' : 'Activate'} <strong>{pendingStatusUser.fullname}</strong> (@{pendingStatusUser.username})?</p>
          {statusError && <p className="form-error" role="alert">{statusError}</p>}
          <div className="user-confirmation-actions">
            <button className="secondary-action" type="button" onClick={() => setPendingStatusUser(null)} disabled={Boolean(busyId)}>Cancel</button>
            <button className={`primary-action ${pendingStatusUser.is_active ? 'danger' : ''}`} type="button" onClick={() => toggleStatus(pendingStatusUser)} disabled={Boolean(busyId)}>
              {busyId ? 'Updating...' : pendingStatusUser.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
export default UserAccounts
import PageSkeleton from '../Shared/PageSkeleton.jsx'
