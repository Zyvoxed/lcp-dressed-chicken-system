import EmptyState from '../Shared/EmptyState.jsx'

function RecentActivity({ activities }) {
  return (
    <article className="panel dashboard-list-panel">
      <header><h2>RECENT ACTIVITY</h2><span className="dashboard-badge">LATEST 5</span></header>
      {!activities.length ? <EmptyState>No activity recorded.</EmptyState> : <div className="dashboard-activity-list">
        {activities.map((activity) => <div className="dashboard-activity-row" key={activity.activity_id}><div className="activity-heading"><strong>{activity.action.replaceAll('_', ' ')}</strong><time>{new Date(activity.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div><p>{activity.description || 'No description provided.'}</p><footer><span>Operator: {activity.username}</span><b>{activity.role}</b></footer></div>)}
      </div>}
    </article>
  )
}

export default RecentActivity
