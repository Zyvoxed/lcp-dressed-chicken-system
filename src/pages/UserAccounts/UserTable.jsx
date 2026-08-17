import { KeyRound, Pencil, Power, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import DataTable from '../Shared/DataTable.jsx'

const columns = ['Operator Full Name', 'Secure Username', 'Contact Phone', 'Auth Role', 'Actions Panel']

function UserTable({ users, currentUserId, onEdit, onResetPassword, onToggleStatus, busyId }) {
  const [roleFilter, setRoleFilter] = useState('All')
  const [query, setQuery] = useState('')
  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) => (roleFilter === 'All' || user.role === roleFilter) && (!needle || [user.fullname, user.username, user.contact_number].some((value) => String(value || '').toLowerCase().includes(needle))))
  }, [query, roleFilter, users])

  return <article className="panel user-registry-panel"><header className="user-registry-header"><div><h2>SYSTEM USER PROFILES REGISTRY</h2><p>Total matched: {filteredUsers.length} secure system handles</p></div><div className="user-registry-controls"><div className="user-role-filter">{['All', 'Admin', 'Staff'].map((role) => <button className={roleFilter === role ? 'active' : ''} type="button" onClick={() => setRoleFilter(role)} key={role}>{role}</button>)}</div><label className="user-registry-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, username or phone" /></label></div></header><DataTable columns={columns} rows={filteredUsers} searchable={false} renderRow={(user) => {
    const current = Number(user.user_id) === Number(currentUserId)
    return <tr className={!user.is_active ? 'inactive-user-row' : ''} key={user.user_id}><td><div className="user-identity"><strong>{user.fullname}</strong>{current && <b>ACTIVE YOU</b>}{!user.is_active && <b className="inactive">INACTIVE</b>}<span>UID: usr-{user.user_id}</span></div></td><td><strong className="secure-username">{user.username}</strong></td><td>{user.contact_number || '—'}</td><td><span className={`user-role-badge ${user.role.toLowerCase()}`}>{user.role}</span></td><td><div className="user-table-actions"><button className="table-action" type="button" onClick={() => onEdit(user)}><Pencil size={12} />Edit</button><button className="table-action" type="button" onClick={() => onResetPassword(user)}><KeyRound size={12} />Reset</button><button className={`table-action ${user.is_active ? 'danger' : 'success'}`} type="button" disabled={busyId === user.user_id || (current && user.is_active)} title={current && user.is_active ? 'You cannot deactivate your own account' : ''} onClick={() => onToggleStatus(user)}><Power size={12} />{user.is_active ? 'Deactivate' : 'Reactivate'}</button></div></td></tr>
  }} /></article>
}
export default UserTable
