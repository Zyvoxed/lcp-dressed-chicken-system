import EmptyState from '../Shared/EmptyState.jsx'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

function RecentActivity({ activities }) {
  return (
    <article className="panel dashboard-list-panel">
      <header><h2>RECENT ACTIVITY</h2><span className="dashboard-badge">LATEST 5</span></header>
      {!activities.length ? <EmptyState>No activity recorded.</EmptyState> : <ul className="dashboard-activity-list">
        {activities.map((activity) => {
          const formattedTimestamp = formatActivityTimestamp(activity.created_at).dateTime
          const operator = activity.operator_name || activity.username || 'System'

          return (
            <li className="dashboard-activity-row" key={activity.activity_id}>
              <div className="activity-heading">
                <div className="dashboard-activity-copy">
                  <strong className="dashboard-activity-operator">{operator}</strong>
                  <span className="dashboard-activity-action">{activity.action.replaceAll('_', ' ')}</span>
                  {activity.description && <span className="dashboard-activity-description">— {activity.description}</span>}
                  <span className="dashboard-activity-role">{activity.role || 'System'}</span>
                </div>
                <time dateTime={activity.created_at}>{formattedTimestamp}</time>
              </div>
            </li>
          )
        })}
      </ul>}
    </article>
  )
}

export default RecentActivity
