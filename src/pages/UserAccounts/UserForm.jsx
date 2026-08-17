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
  return <aside className="panel profile-panel"><header className="profile-panel-header"><h2><UserPlus size={17} />{mode === 'edit' ? 'EDIT SECURE PROFILE' : passwordMode ? 'RESET USER PASSWORD' : 'REGISTER SECURE PROFILE'}</h2><b>{mode === 'create' ? 'CREATION' : mode === 'edit' ? 'UPDATE' : 'SECURITY'}</b></header>{selectedUser && mode !== 'create' && <p className="selected-user-label">Account: <strong>{selectedUser.username}</strong></p>}<form onSubmit={handleSubmit}>{!passwordMode && <><label>LEGAL FULL NAME<input value={form.fullname} onChange={field('fullname')} placeholder="e.g. Maria Angela dela Cruz" required /></label><label>SECURE ACCESS HANDLE (USERNAME)<input value={form.username} onChange={field('username')} placeholder="e.g. mariacruz" required /><small>Unique access credential used during direct login checks.</small></label><label>MOBILE PHONE COORDINATE<input value={form.contact_number} onChange={field('contact_number')} placeholder="e.g. +63 922 123 4567" /></label>{mode === 'create' && <><label>PASSWORD<input type="password" value={form.password} onChange={field('password')} placeholder="Temporary password" required /></label><label>CONFIRM PASSWORD<input type="password" value={form.confirm_password} onChange={field('confirm_password')} placeholder="Repeat temporary password" required /></label></>}<p className="role-selector-label">CREDENTIAL AUTHORIZATION TIER</p><RoleSelector value={form.role} lockAdmin={protectAdminRole} onChange={(role) => setForm((current) => ({ ...current, role }))} /></>}{passwordMode && <><label>NEW PASSWORD<input type="password" value={form.password} onChange={field('password')} required /></label><label>CONFIRM PASSWORD<input type="password" value={form.confirm_password} onChange={field('confirm_password')} required /></label></>}{error && <p className="form-error" role="alert">{error}</p>}<div className="user-form-actions"><button className="primary-action" type="submit" disabled={busy}>{busy ? 'SAVING...' : mode === 'edit' ? 'SAVE CHANGES' : passwordMode ? 'RESET PASSWORD' : 'REGISTER OPERATOR'}</button>{mode !== 'create' && <button className="secondary-action" type="button" onClick={onCancel}>CANCEL</button>}</div></form></aside>
}
export default UserForm
