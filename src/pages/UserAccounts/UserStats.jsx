import { BriefcaseBusiness, ShieldCheck, UserRound } from 'lucide-react'

function MetricCard({ label, value, unit, copy, tone, Icon }) {
  return <article className={`user-metric-card ${tone}`}><span>{label}</span><div><strong>{value}</strong><em>{unit}</em></div><p>{copy}</p><Icon size={18} aria-hidden="true" /></article>
}

function UserStats({ users }) {
  const admins = users.filter((user) => user.role === 'Admin').length
  const staff = users.filter((user) => user.role === 'Staff').length
  return <div className="user-stats-grid full-span"><MetricCard label="TOTAL USERS" value={users.length} unit="users" copy="Registered user accounts" tone="total" Icon={UserRound} /><MetricCard label="ADMIN ACCOUNTS" value={admins} unit="accounts" copy="Users with full system access" tone="admin" Icon={ShieldCheck} /><MetricCard label="STAFF ACCOUNTS" value={staff} unit="users" copy="Staff who record sales, stock, and customer credits" tone="staff" Icon={BriefcaseBusiness} /><article className="user-security-card"><strong>ACCOUNT SECURITY</strong><p>Only admins can change user accounts.</p><span>ROLE ACCESS: ACTIVE</span></article></div>
}
export default UserStats
