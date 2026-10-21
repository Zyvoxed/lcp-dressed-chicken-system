import { useRef, useState } from 'react'
import { KeyRound, UserPlus } from 'lucide-react'
import Modal from '../Shared/Modal.jsx'
import RoleSelector from './RoleSelector.jsx'

const blank = { fullname: '', username: '', email: '', contact_number: '', password: '', confirm_password: '', role: 'Staff' }
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function UserForm({ mode, selectedUser, onCancel, onSubmit, busy, protectAdminRole }) {
  const passwordMode = mode === 'password'
  const [form, setForm] = useState(() => mode === 'edit' && selectedUser ? { ...blank, fullname: selectedUser.fullname, username: selectedUser.username, email: selectedUser.email || '', contact_number: selectedUser.contact_number || '', role: selectedUser.role } : blank)
  const [error, setError] = useState('')
  const [confirmingPassword, setConfirmingPassword] = useState(false)
  const submissionLock = useRef(false)

  function field(name) { return (event) => setForm((current) => ({ ...current, [name]: event.target.value })) }
  async function submitForm() {
    if (submissionLock.current) return
    submissionLock.current = true
    try {
      await onSubmit(form)
      setConfirmingPassword(false)
      if (mode === 'create') setForm(blank)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      submissionLock.current = false
    }
  }
  async function handleSubmit(event) {
    event.preventDefault(); setError('')
    if ((mode === 'create' || mode === 'password') && form.password !== form.confirm_password) { setError('Passwords do not match'); return }
    const email = form.email.trim()
    if (!passwordMode && email && (email.length > 254 || !emailPattern.test(email))) { setError('Enter a valid recovery email address'); return }
    if (passwordMode) { setConfirmingPassword(true); return }
    await submitForm()
  }

  const FormIcon = passwordMode ? KeyRound : UserPlus
  return (
    <aside className="panel profile-panel">
      <header className="profile-panel-header">
        <h2>
          <FormIcon size={17} aria-hidden="true" />
          {mode === 'edit' ? 'Edit Account' : passwordMode ? 'Reset Password' : 'Add Account'}
        </h2>
      </header>
      {selectedUser && mode !== 'create' && <p className="selected-user-label">Account: <strong>{selectedUser.username}</strong></p>}
      <form onSubmit={handleSubmit} aria-busy={busy}>
        {!passwordMode && (
          <>
            <label>
              Full Name
              <input value={form.fullname} onChange={field('fullname')} placeholder="e.g. Maria Angela dela Cruz" disabled={busy} required />
            </label>
            <label>
              Username
              <input value={form.username} onChange={field('username')} placeholder="e.g. mariacruz" disabled={busy} required />
              <small>Used to sign in. Must be unique.</small>
            </label>
            <label>
              Recovery Email (Optional)
              <input type="email" autoComplete="email" maxLength={254} value={form.email} onChange={field('email')} placeholder="e.g. maria@example.com" disabled={busy} />
              <small>A verification link will be sent before this email can be used for account recovery.</small>
            </label>
            <label>
              Contact Number (Optional)
              <input value={form.contact_number} onChange={field('contact_number')} placeholder="e.g. +63 922 123 4567" disabled={busy} />
            </label>
            {mode === 'create' && (
              <>
                <label>
                  Temporary Password
                  <input id="user-password" type="password" autoComplete="new-password" value={form.password} onChange={field('password')} placeholder="Temporary password" disabled={busy} required />
                </label>
                <label>
                  Confirm Password
                  <input id="user-confirm-password" type="password" autoComplete="new-password" value={form.confirm_password} onChange={field('confirm_password')} placeholder="Repeat temporary password" disabled={busy} required />
                </label>
              </>
            )}
            <p className="role-selector-label">Role</p>
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
              New Password
              <input id="user-password" type="password" autoComplete="new-password" value={form.password} onChange={field('password')} placeholder="New password" disabled={busy} required />
            </label>
            <label>
              Confirm Password
              <input id="user-confirm-password" type="password" autoComplete="new-password" value={form.confirm_password} onChange={field('confirm_password')} placeholder="Repeat new password" disabled={busy} required />
            </label>
          </>
        )}
        {error && !confirmingPassword && <p className="form-error" role="alert">{error}</p>}
        <div className="user-form-actions">
          <button className="primary-action" type="submit" disabled={busy}>
            {busy && <span className="user-submit-spinner" aria-hidden="true" />}
            {busy ? 'Saving...' : mode === 'edit' ? 'Save Changes' : passwordMode ? 'Reset Password' : 'Add Account'}
          </button>
          {mode !== 'create' && <button className="secondary-action" type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
        </div>
      </form>
      {confirmingPassword && (
        <Modal title="Confirm Password Reset" onClose={() => { if (!busy) setConfirmingPassword(false) }} className="user-confirmation-modal">
          <p>Reset the password for <strong>{selectedUser.fullname}</strong> (@{selectedUser.username})?</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="user-confirmation-actions">
            <button className="secondary-action" type="button" onClick={() => setConfirmingPassword(false)} disabled={busy}>Cancel</button>
            <button className="primary-action" type="button" onClick={submitForm} disabled={busy}>{busy ? 'Resetting...' : 'Reset Password'}</button>
          </div>
        </Modal>
      )}
    </aside>
  )
}
export default UserForm
