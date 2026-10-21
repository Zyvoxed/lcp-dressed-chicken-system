import { BriefcaseBusiness, ShieldCheck, UserRound } from 'lucide-react'

function MetricCard({ label, value, unit, copy, tone, Icon }) {
  return <article className={`user-metric-card ${tone}`}><span>{label}</span><div><strong>{value}</strong><em>{unit}</em></div><p>{copy}</p><Icon size={18} aria-hidden="true" /></article>
}

function UserStats({ users }) {
  const admins = users.filter((user) => user.role === 'Admin').length
  const staff = users.filter((user) => user.role === 'Staff').length
  return <div className="user-stats-grid full-span"><MetricCard label="TOTAL ACCOUNTS" value={users.length} unit="accounts" copy="All registered accounts" tone="total" Icon={UserRound} /><MetricCard label="ADMIN ACCOUNTS" value={admins} unit="accounts" copy="Owners with full access" tone="admin" Icon={ShieldCheck} /><MetricCard label="STAFF ACCOUNTS" value={staff} unit="accounts" copy="Employees with daily-work access" tone="staff" Icon={BriefcaseBusiness} /></div>
}
export default UserStats
