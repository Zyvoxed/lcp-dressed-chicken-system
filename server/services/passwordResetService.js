import bcrypt from 'bcrypt'
import { timingSafeEqual } from 'node:crypto'
import pool from '../config/database.js'
import {
  createResetToken,
  hashRateLimitIdentifier,
  hashResetToken,
  normalizeResetEmail,
  validateNewPassword,
} from './passwordResetSecurity.js'

const resetLifetimeMilliseconds = 15 * 60 * 1000
const requestCooldownMilliseconds = 60 * 1000
const maximumRequestsPerEmailPerHour = 5
const maximumRequestsPerIpPerHour = 20
const maximumAttemptsPerTokenPerHour = 5
const maximumAttemptsPerIpPerHour = 30
const supportedRoles = ['Admin', 'Staff']

export const passwordResetConfirmation = "If this email is registered, we'll send a password reset link."

export class PasswordResetError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function rateHash(kind, value) {
  return hashRateLimitIdentifier(kind, value, process.env.JWT_SECRET)
}

async function recordRateEvent(executor, action, kind, identifierHash) {
  await executor.execute(
    `INSERT INTO password_reset_rate_limits (action, identifier_kind, identifier_hash)
     VALUES (?, ?, ?)`,
    [action, kind, identifierHash],
  )
}

async function countRecentEvents(executor, action, kind, identifierHash) {
  const [rows] = await executor.execute(
    `SELECT COUNT(*) AS total, MAX(created_at) AS latest
     FROM password_reset_rate_limits
     WHERE action = ? AND identifier_kind = ? AND identifier_hash = ?
       AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)`,
    [action, kind, identifierHash],
  )
  return { total: Number(rows[0]?.total || 0), latest: rows[0]?.latest || null }
}

async function pruneOldRateEvents(executor) {
  await executor.execute(
    `DELETE FROM password_reset_rate_limits
     WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)
     LIMIT 500`,
  )
}

export async function invalidatePasswordResetTokens(executor, userId) {
  await executor.execute(
    `UPDATE password_reset_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  )
}

export async function preparePasswordReset(emailValue, ipAddress) {
  const email = normalizeResetEmail(emailValue)
  const emailHash = rateHash('email', email || '<invalid>')
  const ipHash = rateHash('ip', ipAddress || '<unknown>')
  let connection

  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await pruneOldRateEvents(connection)

    const emailRate = await countRecentEvents(connection, 'request', 'email', emailHash)
    const ipRate = await countRecentEvents(connection, 'request', 'ip', ipHash)

    await recordRateEvent(connection, 'request', 'email', emailHash)
    await recordRateEvent(connection, 'request', 'ip', ipHash)

    const latestRequestTime = emailRate.latest ? new Date(emailRate.latest).getTime() : 0
    const coolingDown = latestRequestTime && Date.now() - latestRequestTime < requestCooldownMilliseconds
    const limited = coolingDown
      || emailRate.total >= maximumRequestsPerEmailPerHour
      || ipRate.total >= maximumRequestsPerIpPerHour

    if (limited || !email || email.length > 254) {
      await connection.commit()
      return null
    }

    const [users] = await connection.execute(
      `SELECT user_id, email, role
       FROM users
       WHERE email = ? AND email_verified_at IS NOT NULL AND is_active = TRUE
         AND role IN ('Admin', 'Staff')
       LIMIT 1
       FOR UPDATE`,
      [email],
    )
    const user = users[0]

    if (!user || !supportedRoles.includes(user.role)) {
      await connection.commit()
      return null
    }

    await invalidatePasswordResetTokens(connection, user.user_id)
    const token = createResetToken()
    const expiresAt = new Date(Date.now() + resetLifetimeMilliseconds)
    const [result] = await connection.execute(
      `INSERT INTO password_reset_tokens (user_id, token_hash, email_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [user.user_id, hashResetToken(token), hashResetToken(user.email), expiresAt],
    )

    await connection.commit()
    return { email: user.email, token, resetId: result.insertId }
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}

export async function revokePasswordResetToken(resetId) {
  await pool.execute(
    `UPDATE password_reset_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE reset_id = ?`,
    [resetId],
  )
}

export async function completePasswordReset(token, passwordValue, ipAddress) {
  const rawToken = typeof token === 'string' ? token : ''
  const tokenHash = hashResetToken(rawToken)
  const ipHash = rateHash('ip', ipAddress || '<unknown>')
  let connection

  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await pruneOldRateEvents(connection)

    const tokenRate = await countRecentEvents(connection, 'attempt', 'token', tokenHash)
    const ipRate = await countRecentEvents(connection, 'attempt', 'ip', ipHash)
    await recordRateEvent(connection, 'attempt', 'token', tokenHash)
    await recordRateEvent(connection, 'attempt', 'ip', ipHash)

    if (tokenRate.total >= maximumAttemptsPerTokenPerHour || ipRate.total >= maximumAttemptsPerIpPerHour) {
      await connection.commit()
      throw new PasswordResetError(429, 'Too many password reset attempts. Try again later.', 3600)
    }

    await connection.commit()

    if (rawToken.length < 40 || rawToken.length > 128) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    let password
    try {
      password = validateNewPassword(passwordValue)
    } catch (error) {
      throw new PasswordResetError(400, error.message)
    }

    await connection.beginTransaction()

    const [tokens] = await connection.execute(
      `SELECT reset_id, user_id, email_hash, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    )
    const reset = tokens[0]

    if (!reset || reset.used_at || new Date(reset.expires_at).getTime() <= Date.now()) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    const [users] = await connection.execute(
      `SELECT user_id, role, is_active, email, email_verified_at
       FROM users
       WHERE user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [reset.user_id],
    )
    const user = users[0]

    const currentEmailHash = user?.email ? hashResetToken(user.email) : null
    const emailMatches = currentEmailHash
      && currentEmailHash.length === reset.email_hash.length
      && timingSafeEqual(currentEmailHash, reset.email_hash)

    if (!user || !user.is_active || !user.email_verified_at || !supportedRoles.includes(user.role) || !emailMatches) {
      throw new PasswordResetError(400, 'This password reset link is invalid or has expired.')
    }

    const passwordHash = await bcrypt.hash(password, 10)
    await connection.execute(
      `UPDATE users
       SET password = ?, auth_version = auth_version + 1
       WHERE user_id = ?`,
      [passwordHash, user.user_id],
    )
    await invalidatePasswordResetTokens(connection, user.user_id)
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'USER_PASSWORD_RESET', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `Password reset completed for user ${user.user_id}`],
    )
    await connection.commit()
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}
