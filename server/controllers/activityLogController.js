import pool from '../config/database.js'

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function getActivityLogs(request, response) {
  try {
    const page = positiveInteger(request.query.page, 1)
    const limit = positiveInteger(request.query.limit, 20, 100)
    const offset = (page - 1) * limit
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
    const clauses = []
    const parameters = []

    if ((request.query.start_date && !validDate(request.query.start_date)) || (request.query.end_date && !validDate(request.query.end_date))) {
      return response.status(400).json({ success: false, message: 'Dates must use YYYY-MM-DD format' })
    }

    if (search) {
      clauses.push('(u.fullname LIKE ? OR u.username LIKE ? OR al.action LIKE ? OR al.description LIKE ?)')
      const term = `%${search}%`
      parameters.push(term, term, term, term)
    }
    if (validDate(request.query.start_date)) {
      clauses.push('al.created_at >= ?')
      parameters.push(request.query.start_date)
    }
    if (validDate(request.query.end_date)) {
      clauses.push('al.created_at < DATE_ADD(?, INTERVAL 1 DAY)')
      parameters.push(request.query.end_date)
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const [countRows] = await pool.execute(`
      SELECT COUNT(*) AS total
      FROM activity_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
      ${where}
    `, parameters)
    const [logs] = await pool.execute(`
      SELECT al.activity_id, al.user_id, al.action, al.description, al.created_at,
             COALESCE(u.username, 'System') AS username,
             COALESCE(u.fullname, 'System') AS fullname,
             COALESCE(u.role, 'System') AS role
      FROM activity_logs al
      LEFT JOIN users u ON u.user_id = al.user_id
      ${where}
      ORDER BY al.created_at DESC, al.activity_id DESC
      LIMIT ? OFFSET ?
    `, [...parameters, limit, offset])
    const total = Number(countRows[0].total)

    return response.json({
      success: true,
      data: logs,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Unable to retrieve activity logs:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve activity logs' })
  }
}
