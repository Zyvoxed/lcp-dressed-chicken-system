import { ChevronLeft, ChevronRight, Clock3, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getActivityLogs } from '../../services/activityLogService.js'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'

const periods = ['All Logs', 'Today', 'This Week', 'This Month']
const actionLabels = {
  LOGIN: 'User Login', LOGOUT: 'User Logout', SYSTEM_INITIALIZE: 'System Initialize',
  SALE_CREATED: 'Sale Created', STOCK_IN_CREATED: 'Stock In', PAYMENT_RECORDED: 'Payment Recorded',
  REPORT_GENERATED: 'Report Generated', USER_CREATED: 'User Created', USER_UPDATED: 'User Updated',
  USER_ACTIVATED: 'User Activated', USER_DEACTIVATED: 'User Deactivated', USER_PASSWORD_RESET: 'Password Reset',
}

function localDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateRange(period) {
  if (period === 'All Logs') return {}
  const today = new Date()
  let start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let end = start
  if (period === 'This Week') {
    const mondayOffset = (start.getDay() + 6) % 7
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate() - mondayOffset)
  }
  if (period === 'This Month') start = new Date(today.getFullYear(), today.getMonth(), 1)
  return { start_date: localDate(start), end_date: localDate(end) }
}

function readableAction(action) {
  return actionLabels[action] || String(action || 'Unknown Activity').toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function actionTone(action) {
  if (['LOGIN', 'LOGOUT'].includes(action)) return 'auth'
  if (action === 'SYSTEM_INITIALIZE') return 'system'
  if (action?.startsWith('USER_')) return 'security'
  if (action?.includes('STOCK') || action?.includes('INVENTORY')) return 'inventory'
  if (action?.includes('SALE') || action?.includes('PAYMENT')) return 'transaction'
  return 'neutral'
}

function ActivityLogs() {
  const [logs, setLogs] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 0 })
  const [page, setPage] = useState(1)
  const [period, setPeriod] = useState('All Logs')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const timeout = setTimeout(() => { setSearch(searchDraft.trim()); setPage(1) }, 300)
    return () => clearTimeout(timeout)
  }, [searchDraft])

  useEffect(() => {
    const controller = new AbortController()
    getActivityLogs({ page, limit: 20, search, ...dateRange(period) }, { signal: controller.signal })
      .then((result) => { setLogs(result.data); setPagination(result.pagination); setError('') })
      .catch((requestError) => { if (requestError.name !== 'AbortError') setError(requestError.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, period, refreshKey, search])

  if (loading) return <LoadingSpinner />
  return <section className="activity-logs-page"><header className="activity-page-header"><div><h1><Clock3 size={25} />Audit &amp; Activity Logs</h1><p>Track user behavior, database updates, point-of-sale checkouts, and system audits for security accountability.</p></div><span><i />System Audits: Active</span></header><article className="activity-filter-panel"><div className="activity-filter-row"><label><Search size={18} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search by user, activity type, or details..." /></label><div>{periods.map((item) => <button className={period === item ? 'active' : ''} type="button" onClick={() => { setPeriod(item); setPage(1) }} key={item}>{item}</button>)}</div></div><footer><span>Found {logs.length} of {pagination.total} logged actions</span><span>Filter: {period}</span></footer></article>{error ? <div className="activity-error"><p>{error}</p><button type="button" onClick={() => setRefreshKey((current) => current + 1)}>Retry</button></div> : <article className="activity-table-panel"><div className="activity-table-scroll"><table><thead><tr><th>No.</th><th>Date</th><th>Time</th><th>User</th><th>Role</th><th>Activity</th><th>Details</th></tr></thead><tbody>{logs.map((log, index) => { const timestamp = new Date(log.created_at); return <tr key={log.activity_id}><td>{(pagination.page - 1) * pagination.limit + index + 1}</td><td>{timestamp.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</td><td>{timestamp.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</td><td><strong>{log.username || 'System'}</strong></td><td><span className={`activity-role ${String(log.role).toLowerCase()}`}>{log.role || 'System'}</span></td><td><span className={`activity-action ${actionTone(log.action)}`}>{readableAction(log.action)}</span></td><td className="activity-details">{log.description || '—'}</td></tr>})}</tbody></table></div>{!logs.length && <EmptyState>{search || period !== 'All Logs' ? 'No activity records match the selected filter.' : 'No activity records found.'}</EmptyState>}{pagination.total_pages > 1 && <footer className="activity-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} />Previous</button><strong>Page {pagination.page} of {pagination.total_pages}</strong><button type="button" disabled={page >= pagination.total_pages} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight size={15} /></button></footer>}</article>}</section>
}

export default ActivityLogs
