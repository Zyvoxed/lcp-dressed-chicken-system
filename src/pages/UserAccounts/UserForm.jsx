import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import RoleSelector from './RoleSelector.jsx'

const blank = { fullname: '', username: '', contact_number: '', password: '', confirm_password: '', role: 'Staff' }

function UserForm({ mode, selectedUser, onCancel, onSubmit, busy, protectAdminRole }) {
  const [form, setForm] = useState(() => mode === 'edit' && selectedUser ? { ...blank, fullname: selectedUser.fullname, username: selectedUser.username, contact_number: selectedUser.contact_number || '', role: selectedUser.role } : blank)
  const [error, setError] = useState('')

  function field(name) { return (event) => setForm((current) => ({ ...current, [name]: event.target.value })) }
  async function handleSubmit(event) {
    event.preventDefault(); setError('')
    if ((mode === 'create' || mode === 'password') && form.password !== form.confirm_password) { setError('Passwords do not match'); return }
    try { await onSubmit(form); if (mode === 'create') setForm(blank) } catch (submitError) { setError(submitError.message) }
  }

  const passwordMode = mode === 'password'
  return (
    <aside className="panel profile-panel">
      <header className="profile-panel-header">
        <h2>
          <UserPlus size={17} aria-hidden="true" />
          {mode === 'edit' ? 'EDIT USER' : passwordMode ? 'RESET USER PASSWORD' : 'ADD USER'}
        </h2>
        <b>{mode === 'create' ? 'CREATION' : mode === 'edit' ? 'UPDATE' : 'SECURITY'}</b>
      </header>
      {selectedUser && mode !== 'create' && <p className="selected-user-label">Account: <strong>{selectedUser.username}</strong></p>}
      <form onSubmit={handleSubmit} aria-busy={busy}>
        {!passwordMode && (
          <>
            <label>
              LEGAL FULL NAME
              <input value={form.fullname} onChange={field('fullname')} placeholder="e.g. Maria Angela dela Cruz" disabled={busy} required />
            </label>
            <label>
              USERNAME
              <input value={form.username} onChange={field('username')} placeholder="e.g. mariacruz" disabled={busy} required />
              <small>Used to sign in. Must be unique.</small>
            </label>
            <label>
              CONTACT NUMBER
              <input value={form.contact_number} onChange={field('contact_number')} placeholder="e.g. +63 922 123 4567" disabled={busy} />
            </label>
            {mode === 'create' && (
              <>
                <label>
                  PASSWORD
                  <input type="password" autoComplete="new-password" value={form.password} onChange={field('password')} placeholder="Temporary password" disabled={busy} required />
                </label>
                <label>
                  CONFIRM PASSWORD
                  <input type="password" autoComplete="new-password" value={form.confirm_password} onChange={field('confirm_password')} placeholder="Repeat temporary password" disabled={busy} required />
                </label>
              </>
            )}
            <p className="role-selector-label">ACCOUNT ROLE</p>
            <RoleSelector
              value={form.role}
              lockAdmin={protectAdminRole}
              disabled={busy}
              onChange={(role) => setForm((current) => ({ ...current, role }))}
            />
          </>
        )}
        {passwordMode && (
          <>
            <label>
              NEW PASSWORD
              <input type="password" autoComplete="new-password" value={form.password} onChange={field('password')} placeholder="New password" disabled={busy} required />
            </label>
            <label>
              CONFIRM PASSWORD
              <input type="password" autoComplete="new-password" value={form.confirm_password} onChange={field('confirm_password')} placeholder="Repeat new password" disabled={busy} required />
            </label>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="user-form-actions">
          <button className="primary-action" type="submit" disabled={busy}>
            {busy && <span className="user-submit-spinner" aria-hidden="true" />}
            {busy ? 'SAVING...' : mode === 'edit' ? 'SAVE CHANGES' : passwordMode ? 'RESET PASSWORD' : 'ADD USER'}
          </button>
          {mode !== 'create' && <button className="secondary-action" type="button" onClick={onCancel} disabled={busy}>CANCEL</button>}
        </div>
      </form>
    </aside>
  )
}
export default UserForm
