import { Archive, BriefcaseBusiness, ShieldCheck, UserRound } from 'lucide-react'

function MetricCard({ label, value, unit, copy, tone, Icon, onClick, clickable }) {
  const CardTag = clickable ? 'button' : 'article'
  return (
    <CardTag
      className={`user-metric-card ${tone}${clickable ? ' is-clickable' : ''}`}
      type={clickable ? 'button' : undefined}
      onClick={onClick}
    >
      <div className="user-metric-header">
        <span>{label}</span>
        <div className="user-metric-icon">
          <Icon size={17} aria-hidden="true" />
        </div>
      </div>
      <div className="user-metric-body">
        <strong>{value}</strong>
        <em>{unit}</em>
      </div>
      <p>{copy}</p>
    </CardTag>
  )
}

function UserStats({ users = [], archivedUsers = [], onShowArchived }) {
  const admins = users.filter((user) => user.role === 'Admin').length
  const staff = users.filter((user) => user.role === 'Staff').length

  return (
    <div className="user-stats-grid full-span">
      <MetricCard
        label="ACTIVE ACCOUNTS"
        value={users.length}
        unit="accounts"
        copy="Active authorized users"
        tone="total"
        Icon={UserRound}
      />
      <MetricCard
        label="ADMIN ACCOUNTS"
        value={admins}
        unit="accounts"
        copy="Full system permissions"
        tone="admin"
        Icon={ShieldCheck}
      />
      <MetricCard
        label="STAFF ACCOUNTS"
        value={staff}
        unit="accounts"
        copy="Operations & sales access"
        tone="staff"
        Icon={BriefcaseBusiness}
      />
      <MetricCard
        label="ARCHIVED ACCOUNTS"
        value={archivedUsers.length}
        unit="accounts"
        copy={archivedUsers.length ? 'Click to view & restore' : 'No accounts archived'}
        tone="archived"
        Icon={Archive}
        clickable={Boolean(onShowArchived)}
        onClick={onShowArchived}
      />
    </div>
  )
}

export default UserStats
