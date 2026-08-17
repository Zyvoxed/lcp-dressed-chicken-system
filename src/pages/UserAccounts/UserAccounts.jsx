import { useEffect, useState } from 'react'
import { ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth.js'
import { createUser, getUsers, resetUserPassword, updateUser, updateUserStatus } from '../../services/userService.js'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
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
      if (mode === 'create') result = await createUser({ fullname: form.fullname, username: form.username, contact_number: form.contact_number, password: form.password, role: form.role })
      else if (mode === 'edit') result = await updateUser(selectedUser.user_id, { fullname: form.fullname, username: form.username, contact_number: form.contact_number, role: form.role })
      else result = await resetUserPassword(selectedUser.user_id, form.password)
      choose('create'); setNotice(result.message); await loadUsers()
    } finally { setBusy(false) }
  }
  async function toggleStatus(user) {
    setBusyId(user.user_id); setNotice(''); setError('')
    try { const result = await updateUserStatus(user.user_id, !user.is_active); setNotice(result.message); await loadUsers() }
    catch (requestError) { setError(requestError.message) }
    finally { setBusyId(null) }
  }

  if (loading) return <LoadingSpinner />
  return <section className="users-layout"><header className="user-accounts-intro full-span"><div><h1><span><ShieldCheck size={12} />ADMIN</span>USER ACCOUNTS CREDENTIALS DECK</h1><p>Configure system access logs, operational credentials, contact coordinates, and authorization hierarchies for LCP staff members and administrative partners.</p></div><strong><UserRound size={15} />Operator: <b>{currentUser?.fullname || currentUser?.username || 'Authenticated user'}</b></strong></header><div className="full-span user-feedback-stack">{error && <div className="users-feedback error" role="alert">{error}</div>}{notice && <div className="users-feedback success">{notice}</div>}</div><UserStats users={users} />{!users.length && error ? <EmptyState>{error}</EmptyState> : <UserTable users={users} currentUserId={currentUser?.user_id} onEdit={(user) => choose('edit', user)} onResetPassword={(user) => choose('password', user)} onToggleStatus={toggleStatus} busyId={busyId} />}<UserForm key={`${mode}-${selectedUser?.user_id || 'new'}`} mode={mode} selectedUser={selectedUser} protectAdminRole={mode === 'edit' && Number(selectedUser?.user_id) === Number(currentUser?.user_id)} onCancel={() => choose('create')} onSubmit={submit} busy={busy} /></section>
}
export default UserAccounts
