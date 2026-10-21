import EmptyState from '../Shared/EmptyState.jsx'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

function RecentActivity({ activities }) {
  return (
    <article className="panel dashboard-list-panel">
      <header><h2>RECENT ACTIVITY</h2><span className="dashboard-badge">LATEST 5</span></header>
      {!activities.length ? <EmptyState>No activity recorded.</EmptyState> : <div className="dashboard-activity-list">
        {activities.map((activity) => {
          const formattedTimestamp = formatActivityTimestamp(activity.created_at).dateTime

          return (
            <div className="dashboard-activity-row" key={activity.activity_id}>
              <div className="activity-heading">
                <strong>{activity.action.replaceAll('_', ' ')}</strong>
                <time dateTime={activity.created_at}>{formattedTimestamp}</time>
              </div>
              <p>{activity.description || 'No description provided.'}</p>
              <footer>
                <span>Operator: {activity.operator_name || activity.username || 'System'}</span>
                <b>{activity.role || 'System'}</b>
              </footer>
            </div>
          )
        })}
      </div>}
    </article>
  )
}

export default RecentActivity
