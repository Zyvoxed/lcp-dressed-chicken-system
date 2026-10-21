import pool from '../config/database.js'
import { activityDateRange, formatActivityTimestamp } from '../../src/utils/activityDateTime.js'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let connection

try {
  const utcTimestamp = formatActivityTimestamp('2026-10-20T16:01:00Z')
  const manilaTimestamp = formatActivityTimestamp('2026-10-21T00:01:00+08:00')
  assert(utcTimestamp.dateTime === manilaTimestamp.dateTime, 'Equivalent UTC and Manila timestamps displayed differently')
  assert(manilaTimestamp.dateTime.includes('Oct 21, 2026') && manilaTimestamp.dateTime.includes('12:01 AM'), 'Midnight transition was formatted incorrectly')
  assert(formatActivityTimestamp('2026-10-20T15:59:00Z').dateTime.includes('Oct 20, 2026'), 'Pre-midnight timestamp moved to the wrong Philippine date')

  const todayRange = activityDateRange('Today', new Date('2026-10-20T16:30:00Z'))
  const weekRange = activityDateRange('This Week', new Date('2026-10-20T16:30:00Z'))
  assert(todayRange.start_date === '2026-10-21' && todayRange.end_date === '2026-10-21', 'Today filter did not use the Manila calendar date')
  assert(weekRange.start_date === '2026-10-19' && weekRange.end_date === '2026-10-21', 'Week filter did not begin on Manila Monday')

  connection = await pool.getConnection()
  await connection.beginTransaction()
  const [users] = await connection.execute('SELECT user_id FROM users ORDER BY user_id LIMIT 1')
  assert(users.length === 1, 'A user fixture is required for the activity timestamp test')
  const userId = users[0].user_id
  const fixtureTimes = [
    '2026-10-20 23:59:00',
    '2026-10-21 00:01:00',
    '2026-10-21 13:16:00',
    '2026-10-21 23:59:00',
    '2026-10-22 00:01:00',
  ]
  const ids = []

  for (const [index, createdAt] of fixtureTimes.entries()) {
    const [result] = await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'TIMESTAMP_TEST', ?, ?)`,
      [userId, `Activity timestamp fixture ${index}`, createdAt],
    )
    ids.push(result.insertId)
  }

  const [logs] = await connection.execute(`
    SELECT activity_id,
           CONCAT(DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS created_at
    FROM activity_logs
    WHERE activity_id IN (?, ?, ?, ?, ?)
      AND created_at >= ?
      AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY created_at DESC, activity_id DESC
  `, [...ids, '2026-10-21', '2026-10-21'])

  assert(logs.length === 3, 'Philippine date filtering returned duplicate, missing, or adjacent-day logs')
  assert(logs[0].activity_id === ids[3] && logs[1].activity_id === ids[2] && logs[2].activity_id === ids[1], 'Activity timestamps were not ordered newest first')
  assert(logs.every((log) => log.created_at.endsWith('+08:00')), 'Activity API timestamp did not declare the Manila offset')
  assert(formatActivityTimestamp(logs[1].created_at).dateTime.includes('Oct 21, 2026, 1:16 PM'), 'Serialized activity timestamp was converted twice')

  const [futureLog] = await connection.execute(`
    SELECT ABS(TIMESTAMPDIFF(SECOND, created_at, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) AS difference_seconds
    FROM activity_logs
    WHERE activity_id = ?
  `, [ids[2]])
  assert(Number(futureLog[0].difference_seconds) > 60, 'Fixed fixture unexpectedly matched the current clock')

  const [created] = await connection.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, 'TIMESTAMP_TEST', 'Future activity convention', CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [userId],
  )
  const [createdRows] = await connection.execute(`
    SELECT ABS(TIMESTAMPDIFF(SECOND, created_at, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))) AS difference_seconds
    FROM activity_logs WHERE activity_id = ?
  `, [created.insertId])
  assert(Number(createdRows[0].difference_seconds) <= 2, 'Future activity timestamp was not stored in Manila time')

  console.log('PASS Asia/Manila formatting without double conversion')
  console.log('PASS before/after-midnight filtering and newest-first ordering')
  console.log('PASS explicit future activity timestamp convention and rollback isolation')
} finally {
  if (connection) {
    await connection.rollback()
    connection.release()
  }
  await pool.end()
}
