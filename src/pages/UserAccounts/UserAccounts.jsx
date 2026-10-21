import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth.js'
import { createUser, getUsers, resendEmailVerification, resetUserPassword, updateUser, updateUserStatus } from '../../services/userService.js'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import Modal from '../Shared/Modal.jsx'
import UserForm from './UserForm.jsx'
import UserStats from './UserStats.jsx'
import UserTable from './UserTable.jsx'

function UserAccounts() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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

  function choose(nextMode, user = null) { setMode(nextMode); setSelectedUser(user); setNotice('') }
  async function submit(form) {
    setBusy(true)
    try {
      let result
      if (mode === 'create') result = await createUser({ fullname: form.fullname, username: form.username, email: form.email, contact_number: form.contact_number, password: form.password, role: form.role })
      else if (mode === 'edit') result = await updateUser(selectedUser.user_id, { fullname: form.fullname, username: form.username, email: form.email, contact_number: form.contact_number, role: form.role })
      else result = await resetUserPassword(selectedUser.user_id, form.password)
      choose('create'); setNotice(result.message); await loadUsers()
    } finally { setBusy(false) }
  }
  async function toggleStatus(user) {
    if (statusLock.current) return
    statusLock.current = true
    setBusyId(user.user_id); setNotice(''); setError(''); setStatusError('')
    try { const result = await updateUserStatus(user.user_id, !user.is_active); setNotice(result.message); await loadUsers(); setPendingStatusUser(null) }
    catch (requestError) { setStatusError(requestError.message) }
    finally { statusLock.current = false; setBusyId(null) }
  }
  async function sendVerification(user) {
    if (verificationLock.current) return
    verificationLock.current = true
    setVerificationBusyId(user.user_id); setNotice(''); setError('')
    try { const result = await resendEmailVerification(user.user_id); setNotice(result.message) }
    catch (requestError) { setError(requestError.message) }
    finally { verificationLock.current = false; setVerificationBusyId(null) }
  }

  if (loading) return <LoadingSpinner />
  return (
    <section className="users-layout">
      <div className="full-span user-feedback-stack">
        {error && users.length > 0 && <div className="users-feedback error" role="alert">{error}</div>}
        {notice && <div className="users-feedback success" role="status">{notice}</div>}
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
