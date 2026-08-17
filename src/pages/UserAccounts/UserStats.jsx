import { BriefcaseBusiness, ShieldCheck, UserRound } from 'lucide-react'

function MetricCard({ label, value, unit, copy, tone, Icon }) {
  return <article className={`user-metric-card ${tone}`}><span>{label}</span><div><strong>{value}</strong><em>{unit}</em></div><p>{copy}</p><Icon size={18} aria-hidden="true" /></article>
}

function UserStats({ users }) {
  const admins = users.filter((user) => user.role === 'Admin').length
  const staff = users.filter((user) => user.role === 'Staff').length
  return <div className="user-stats-grid full-span"><MetricCard label="SUM TOTAL REGISTERED" value={users.length} unit="profiles" copy="LCP system-registered credential sets" tone="total" Icon={UserRound} /><MetricCard label="ADMINISTRATORS" value={admins} unit="accounts" copy="Unrestricted administrative key-holders" tone="admin" Icon={ShieldCheck} /><MetricCard label="DRESSED CHICKEN STAFF" value={staff} unit="personnel" copy="Operational POS cashier and stock agents" tone="staff" Icon={BriefcaseBusiness} /><article className="user-security-card"><strong>SECURITY ACCESS LOCK</strong><p>System is secured and validated. Modifications require registered administrator authentication logs.</p><span>ROLE ENFORCEMENT LEVEL: HIGH</span></article></div>
}
export default UserStats
