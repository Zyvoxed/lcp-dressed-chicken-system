import bcrypt from 'bcrypt'
import pool from '../config/database.js'
import {
  EmailVerificationError,
  invalidateEmailVerificationTokens,
  issueEmailVerificationToken,
  normalizeRecoveryEmail,
  revokeEmailVerificationToken,
  validateRecoveryEmail,
} from '../services/emailVerificationService.js'
import { sendEmailVerification } from '../services/emailDeliveryService.js'
import { invalidatePasswordResetTokens } from '../services/passwordResetService.js'

class UserError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const safeFields = `user_id, fullname, username, email, email_verified_at, role, contact_number,
  is_active, created_at, updated_at`

function positiveId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new UserError(400, 'Invalid user ID')
  return id
}

function userDetails(body) {
  const fullname = typeof body?.fullname === 'string' ? body.fullname.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const emailProvided = Object.prototype.hasOwnProperty.call(body || {}, 'email')
  const email = emailProvided ? normalizeRecoveryEmail(body.email) : null
  const contactNumber = typeof body?.contact_number === 'string' ? body.contact_number.trim() : ''
  const role = body?.role
  if (!fullname) throw new UserError(400, 'Full name is required')
  if (!username) throw new UserError(400, 'Username is required')
  validateRecoveryEmail(email)
  if (!['Admin', 'Staff'].includes(role)) throw new UserError(400, 'Role must be Admin or Staff')
  return { fullname, username, email, emailProvided, contactNumber: contactNumber || null, role }
}

async function findUser(executor, userId, forUpdate = false) {
  const [rows] = await executor.execute(`SELECT ${safeFields} FROM users WHERE user_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [userId])
  if (!rows[0]) throw new UserError(404, 'User not found')
  return rows[0]
}

async function uniqueUsername(executor, username, excludedId = 0) {
  const [rows] = await executor.execute('SELECT user_id FROM users WHERE username = ? AND user_id <> ? LIMIT 1', [username, excludedId])
  if (rows.length) throw new UserError(409, 'Username is already in use')
}

async function uniqueEmail(executor, email, excludedId = 0) {
  if (!email) return
  const [rows] = await executor.execute('SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1', [email, excludedId])
  if (rows.length) throw new UserError(409, 'Recovery email is already in use')
}

async function activity(executor, adminId, action, description) {
  await executor.execute('INSERT INTO activity_logs (user_id, action, description) VALUES (?, ?, ?)', [adminId, action, description])
}

function failure(error, response, fallback) {
  if (error instanceof UserError || error instanceof EmailVerificationError) {
    if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
    return response.status(error.status).json({ success: false, message: error.message })
  }
  if (error?.code === 'ER_DUP_ENTRY') {
    return response.status(409).json({ success: false, message: 'Username or recovery email is already in use' })
  }
  console.error(`${fallback}:`, error.message)
  return response.status(500).json({ success: false, message: fallback })
}

async function deliverVerification(email, issued) {
  if (!email || !issued) return true
  try {
    await sendEmailVerification({ email, ...issued })
    return true
  } catch {
    try { await revokeEmailVerificationToken(issued.verificationId) } catch { /* The token still expires and remains single-use. */ }
    return false
  }
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
    await uniqueEmail(connection, details.email)
    const hash = await bcrypt.hash(password, 10)
    const [result] = await connection.execute('INSERT INTO users (fullname, username, email, password, role, contact_number) VALUES (?, ?, ?, ?, ?, ?)', [details.fullname, details.username, details.email, hash, details.role, details.contactNumber])
    const verification = details.email
      ? await issueEmailVerificationToken(connection, result.insertId, details.email)
      : null
    await activity(connection, request.user.user_id, 'USER_CREATED', `User ${result.insertId} (${details.username}) created with role ${details.role}`)
    const user = await findUser(connection, result.insertId)
    await connection.commit()
    connection.release(); connection = null
    const delivered = await deliverVerification(details.email, verification)
    const message = verification && !delivered
      ? 'User created. The recovery email was saved, but the verification email could not be sent.'
      : verification
        ? 'User created. A verification email was sent.'
        : 'User created successfully'
    return response.status(201).json({ success: true, message, data: user })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to create user') }
  finally { connection?.release() }
}

export async function updateUser(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id); const details = userDetails(request.body)
    if (userId === request.user.user_id && details.role !== 'Admin') throw new UserError(400, 'You cannot change your own Admin account to Staff')
    connection = await pool.getConnection(); await connection.beginTransaction()
    const existing = await findUser(connection, userId, true)
    const nextEmail = details.emailProvided ? details.email : existing.email
    await uniqueUsername(connection, details.username, userId); await uniqueEmail(connection, nextEmail, userId)
    const emailChanged = existing.email !== nextEmail
    await connection.execute(
      `UPDATE users
       SET fullname = ?, username = ?, email = ?, email_verified_at = ?, role = ?, contact_number = ?
       WHERE user_id = ?`,
      [details.fullname, details.username, nextEmail, emailChanged ? null : existing.email_verified_at, details.role, details.contactNumber, userId],
    )
    let verification = null
    if (emailChanged) {
      if (nextEmail) verification = await issueEmailVerificationToken(connection, userId, nextEmail)
      else await invalidateEmailVerificationTokens(connection, userId)
    }
    await activity(connection, request.user.user_id, 'USER_UPDATED', `User ${userId} (${details.username}) details updated`)
    const user = await findUser(connection, userId); await connection.commit()
    connection.release(); connection = null
    const delivered = await deliverVerification(nextEmail, verification)
    const message = verification && !delivered
      ? 'User updated. The recovery email was saved, but the verification email could not be sent.'
      : verification
        ? 'User updated. A verification email was sent.'
        : 'User updated successfully'
    return response.json({ success: true, message, data: user })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to update user') }
  finally { connection?.release() }
}

export async function updateUserStatus(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id)
    if (typeof request.body?.is_active !== 'boolean') throw new UserError(400, 'Account status must be active or inactive')
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
    await connection.execute(
      'UPDATE users SET password = ?, auth_version = auth_version + 1 WHERE user_id = ?',
      [await bcrypt.hash(password, 10), userId],
    )
    await invalidatePasswordResetTokens(connection, userId)
    await activity(connection, request.user.user_id, 'USER_PASSWORD_RESET', `Password reset for user ${userId} (${user.username})`)
    await connection.commit()
    return response.json({ success: true, message: 'Password reset successfully' })
  } catch (error) { if (connection) await connection.rollback(); return failure(error, response, 'Unable to reset password') }
  finally { connection?.release() }
}
