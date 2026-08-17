import bcrypt from 'bcrypt'
import pool from '../config/database.js'

class UserError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const safeFields = `user_id, fullname, username, role, contact_number,
  is_active, created_at, updated_at`

function positiveId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new UserError(400, 'Invalid user ID')
  return id
}

function userDetails(body) {
  const fullname = typeof body?.fullname === 'string' ? body.fullname.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const contactNumber = typeof body?.contact_number === 'string' ? body.contact_number.trim() : ''
  const role = body?.role
  if (!fullname) throw new UserError(400, 'Full name is required')
  if (!username) throw new UserError(400, 'Username is required')
  if (!['Admin', 'Staff'].includes(role)) throw new UserError(400, 'Role must be Admin or Staff')
  return { fullname, username, contactNumber: contactNumber || null, role }
}

async function findUser(executor, userId) {
  const [rows] = await executor.execute(`SELECT ${safeFields} FROM users WHERE user_id = ? LIMIT 1`, [userId])
  if (!rows[0]) throw new UserError(404, 'User not found')
  return rows[0]
}

async function uniqueUsername(executor, username, excludedId = 0) {
  const [rows] = await executor.execute('SELECT user_id FROM users WHERE username = ? AND user_id <> ? LIMIT 1', [username, excludedId])
  if (rows.length) throw new UserError(409, 'Username is already in use')
}

async function activity(executor, adminId, action, description) {
  await executor.execute('INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)', [adminId, action, description])
}

function failure(error, response, fallback) {
  if (error instanceof UserError) return response.status(error.status).json({ success: false, message: error.message })
  console.error(`${fallback}:`, error.message)
  return response.status(500).json({ success: false, message: fallback })
}

export async function getUsers(request, response) {
  try {
    const [users] = await pool.execute(`SELECT ${safeFields} FROM users ORDER BY created_at DESC, user_id DESC`)
    return response.json({ success: true, data: users })
  } catch (error) { return failure(error, response, 'Unable to retrieve users') }
}

export async function getUserById(request, response) {
  try { return response.json({ success: true, data: await findUser(pool, positiveId(request.params.id)) }) }
  catch (error) { return failure(error, response, 'Unable to retrieve user') }
}

export async function createUser(request, response) {
  let connection
  try {
    const details = userDetails(request.body)
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    if (!password.trim()) throw new UserError(400, 'Password is required')
    connection = await pool.getConnection(); await connection.beginTransaction()
    await uniqueUsername(connection, details.username)
    const hash = await bcrypt.hash(password, 10)
    const [result] = await connection.execute('INSERT INTO users (fullname, username, password, role, contact_number) VALUES (?, ?, ?, ?, ?)', [details.fullname, details.username, hash, details.role, details.contactNumber])
    await activity(connection, request.user.user_id, 'USER_CREATED', `User ${result.insertId} (${details.username}) created with role ${details.role}`)
    const user = await findUser(connection, result.insertId)
    await connection.commit()
    return response.status(201).json({ success: true, message: 'User created successfully', data: user })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to create user') }
  finally { connection?.release() }
}

export async function updateUser(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id); const details = userDetails(request.body)
    if (userId === request.user.user_id && details.role !== 'Admin') throw new UserError(400, 'You cannot demote your own active Admin account')
    connection = await pool.getConnection(); await connection.beginTransaction()
    await findUser(connection, userId); await uniqueUsername(connection, details.username, userId)
    await connection.execute('UPDATE users SET fullname = ?, username = ?, role = ?, contact_number = ? WHERE user_id = ?', [details.fullname, details.username, details.role, details.contactNumber, userId])
    await activity(connection, request.user.user_id, 'USER_UPDATED', `User ${userId} (${details.username}) details updated`)
    const user = await findUser(connection, userId); await connection.commit()
    return response.json({ success: true, message: 'User updated successfully', data: user })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to update user') }
  finally { connection?.release() }
}

export async function updateUserStatus(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id)
    if (typeof request.body?.is_active !== 'boolean') throw new UserError(400, 'is_active must be boolean')
    if (userId === request.user.user_id && !request.body.is_active) throw new UserError(400, 'You cannot deactivate your own account')
    connection = await pool.getConnection(); await connection.beginTransaction()
    const user = await findUser(connection, userId)
    await connection.execute('UPDATE users SET is_active = ? WHERE user_id = ?', [request.body.is_active, userId])
    const action = request.body.is_active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED'
    await activity(connection, request.user.user_id, action, `User ${userId} (${user.username}) ${request.body.is_active ? 'activated' : 'deactivated'}`)
    const updated = await findUser(connection, userId); await connection.commit()
    return response.json({ success: true, message: `User ${request.body.is_active ? 'activated' : 'deactivated'} successfully`, data: updated })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to update user status') }
  finally { connection?.release() }
}

export async function resetUserPassword(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id)
    const password = typeof request.body?.new_password === 'string' ? request.body.new_password : ''
    if (!password.trim()) throw new UserError(400, 'New password is required')
    connection = await pool.getConnection(); await connection.beginTransaction()
    const user = await findUser(connection, userId)
    await connection.execute('UPDATE users SET password = ? WHERE user_id = ?', [await bcrypt.hash(password, 10), userId])
    await activity(connection, request.user.user_id, 'USER_PASSWORD_RESET', `Password reset for user ${userId} (${user.username})`)
    await connection.commit()
    return response.json({ success: true, message: 'Password reset successfully' })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to reset password') }
  finally { connection?.release() }
}
