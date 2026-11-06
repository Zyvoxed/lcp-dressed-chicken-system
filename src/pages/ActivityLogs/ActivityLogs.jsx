import { CalendarRange, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getActivityLogs } from '../../services/activityLogService.js'
import { activityDateRange, formatActivityTimestamp } from '../../utils/activityDateTime.js'
import EmptyState from '../Shared/EmptyState.jsx'

const periods = ['All Logs', 'Today', 'This Week', 'This Month']
const actionLabels = {
  LOGIN: 'Signed In', LOGOUT: 'Signed Out', SYSTEM_INITIALIZE: 'System Started',
  SALE_CREATED: 'Recorded a Sale', STOCK_IN_CREATED: 'Added Stock', PAYMENT_RECORDED: 'Recorded a Payment',
  REPORT_GENERATED: 'Created a Report', PRODUCT_CREATED: 'Added a Product', PRODUCT_UPDATED: 'Updated a Product',
  USER_CREATED: 'Added an Account', USER_UPDATED: 'Updated an Account',
  USER_ACTIVATED: 'Activated an Account', USER_DEACTIVATED: 'Deactivated an Account', USER_PASSWORD_RESET: 'Reset a Password',
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

function manilaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1000) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

function ActivityLogs() {
  const customButtonRef = useRef(null)
  const popoverRef = useRef(null)
  const [logs, setLogs] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 0 })
  const [page, setPage] = useState(1)
  const [period, setPeriod] = useState('All Logs')
  const [customDates, setCustomDates] = useState(() => {
    const today = manilaDateString()
    return { start_date: today, end_date: today }
  })
  const [customRange, setCustomRange] = useState(null)
  const [customError, setCustomError] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState(null)
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
    const dateFilter = period === 'Custom' ? customRange || {} : activityDateRange(period)
    getActivityLogs({ page, limit: 20, search, ...dateFilter }, { signal: controller.signal })
      .then((result) => { setLogs(result.data); setPagination(result.pagination); setError('') })
      .catch((requestError) => { if (requestError.name !== 'AbortError') setError(requestError.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [customRange, page, period, refreshKey, search])

  useLayoutEffect(() => {
    if (!popoverOpen || !customButtonRef.current || !popoverRef.current) return undefined

    function positionPopover() {
      const button = customButtonRef.current?.getBoundingClientRect()
      const panel = popoverRef.current?.getBoundingClientRect()
      if (!button || !panel) return

      const margin = 12
      const gap = 8
      const left = Math.min(
        Math.max(button.right - panel.width, margin),
        window.innerWidth - panel.width - margin,
      )
      const below = button.bottom + panel.height + gap <= window.innerHeight - margin
      const top = below
        ? button.bottom + gap
        : Math.max(margin, button.top - panel.height - gap)
      setPopoverPosition({ left, top })
    }

    positionPopover()
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)
    return () => {
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
    }
  }, [popoverOpen, customError])

  useEffect(() => {
    if (!popoverOpen) return undefined

    function dismiss(event) {
      if (event.key === 'Escape') setPopoverOpen(false)
    }

    function dismissOutside(event) {
      if (
        !popoverRef.current?.contains(event.target)
        && !customButtonRef.current?.contains(event.target)
      ) {
        setPopoverOpen(false)
      }
    }

    document.addEventListener('keydown', dismiss)
    document.addEventListener('pointerdown', dismissOutside)
    return () => {
      document.removeEventListener('keydown', dismiss)
      document.removeEventListener('pointerdown', dismissOutside)
    }
  }, [popoverOpen])

  function applyCustomRange(event) {
    event.preventDefault()
    setCustomError('')
    const { start_date: startDate, end_date: endDate } = customDates
    if (!validDate(startDate) || !validDate(endDate)) {
      setCustomError('Select valid start and end dates.')
      return
    }
    if (startDate > endDate) {
      setCustomError('Start Date cannot be later than End Date.')
      return
    }

    setCustomRange({ start_date: startDate, end_date: endDate })
    setPeriod('Custom')
    setPage(1)
    setPopoverOpen(false)
  }

  if (loading) return <PageSkeleton variant="activity" label="activity logs" />;

  return (
    <section className="activity-logs-page">
      <article className="activity-filter-panel">
        <div className="activity-filter-row">
          <label>
            <Search size={18} aria-hidden="true" />
            <input aria-label="Search activity logs" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search by user, action, or details..." />
          </label>
          <div>
            {periods.map((item) => (
              <button className={period === item ? 'active' : ''} type="button" aria-pressed={period === item} onClick={() => { setPeriod(item); setPage(1) }} key={item}>{item === 'All Logs' ? 'All Activity' : item}</button>
            ))}
            <button
              ref={customButtonRef}
              className={period === 'Custom' ? 'active' : ''}
              type="button"
              aria-pressed={period === 'Custom'}
              aria-expanded={popoverOpen}
              aria-controls="activity-date-popover"
              onClick={() => {
                const today = manilaDateString()
                setCustomDates(customRange || { start_date: today, end_date: today })
                setCustomError('')
                setPopoverOpen((open) => !open)
              }}
            >
              <CalendarRange size={13} aria-hidden="true" />
              Custom
            </button>
          </div>
        </div>
        {popoverOpen && (
          <form
            ref={popoverRef}
            id="activity-date-popover"
            className="activity-date-popover"
            onSubmit={applyCustomRange}
            style={{
              left: popoverPosition?.left ?? 12,
              top: popoverPosition?.top ?? 12,
            }}
            aria-label="Custom activity date range"
          >
            <label>
              Start Date
              <input
                type="date"
                value={customDates.start_date}
                onChange={(event) => setCustomDates((current) => ({ ...current, start_date: event.target.value }))}
              />
            </label>
            <label>
              End Date
              <input
                type="date"
                value={customDates.end_date}
                onChange={(event) => setCustomDates((current) => ({ ...current, end_date: event.target.value }))}
              />
            </label>
            {customError && <p className="activity-date-error" role="alert">{customError}</p>}
            <div className="activity-date-actions">
              <button type="button" onClick={() => setPopoverOpen(false)}>Cancel</button>
              <button className="active" type="submit">Apply</button>
            </div>
          </form>
        )}
        <footer>
          <span>Showing {logs.length} of {pagination.total} records</span>
          {period === 'Custom' && customRange && (
            <span>Custom period: {customRange.start_date} to {customRange.end_date}</span>
          )}
        </footer>
      </article>

      {error ? (
        <div className="activity-error">
          <p role="alert">{error}</p>
          <button type="button" onClick={() => setRefreshKey((current) => current + 1)}>Retry</button>
        </div>
      ) : (
        <article className="activity-table-panel">
          <div className="activity-table-scroll" role="region" aria-label="Activity log records" tabIndex={0}>
            <table className="system-data-table">
              <thead><tr><th>No.</th><th>Date</th><th>Time</th><th>User</th><th>Role</th><th>Activity</th><th>Details</th></tr></thead>
              <tbody>
                {logs.map((log, index) => {
                  const timestamp = formatActivityTimestamp(log.created_at)
                  return (
                    <tr key={log.activity_id}>
                      <td>{(pagination.page - 1) * pagination.limit + index + 1}</td>
                      <td><time dateTime={log.created_at}>{timestamp.date}</time></td>
                      <td>{timestamp.time}</td>
                      <td><div className="activity-user"><strong>{log.fullname || log.username || 'System'}</strong>{log.username && log.username !== 'System' && <span>@{log.username}</span>}</div></td>
                      <td><span className={`activity-role ${String(log.role).toLowerCase()}`}>{log.role || 'System'}</span></td>
                      <td><span className={`activity-action ${actionTone(log.action)}`}>{readableAction(log.action)}</span></td>
                      <td className="activity-details">{log.description || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!logs.length && <EmptyState>{search || period !== 'All Logs' ? 'No activity records match the selected filter.' : 'No activity records found.'}</EmptyState>}
          {pagination.total_pages > 1 && (
            <footer className="activity-pagination">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={15} aria-hidden="true" />Previous</button>
              <strong>Page {pagination.page} of {pagination.total_pages}</strong>
              <button type="button" disabled={page >= pagination.total_pages} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight size={15} aria-hidden="true" /></button>
            </footer>
          )}
        </article>
      )}
    </section>
  )
}

export default ActivityLogs
import PageSkeleton from '../Shared/PageSkeleton.jsx'
