import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import pool from '../config/database.js'

const tokenLifetimeMilliseconds = 24 * 60 * 60 * 1000
const resendCooldownMilliseconds = 60 * 1000
const maximumEmailsPerHour = 5
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class EmailVerificationError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function normalizeRecoveryEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email || null
}

export function validateRecoveryEmail(email) {
  if (!email) return
  if (email.length > 254 || !emailPattern.test(email)) {
    throw new EmailVerificationError(400, 'Enter a valid recovery email address')
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest()
}

export async function invalidateEmailVerificationTokens(executor, userId) {
  await executor.execute(
    `UPDATE email_verification_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  )
}

export async function issueEmailVerificationToken(executor, userId, email) {
  const [recentTokens] = await executor.execute(
    `SELECT created_at
     FROM email_verification_tokens
     WHERE user_id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)
     ORDER BY created_at DESC`,
    [userId],
  )

  if (recentTokens.length >= maximumEmailsPerHour) {
    throw new EmailVerificationError(429, 'Too many verification emails were requested. Try again later.')
  }

  if (recentTokens[0]) {
    const elapsed = Date.now() - new Date(recentTokens[0].created_at).getTime()
    if (elapsed < resendCooldownMilliseconds) {
      const retryAfterSeconds = Math.max(1, Math.ceil((resendCooldownMilliseconds - elapsed) / 1000))
      throw new EmailVerificationError(429, 'Please wait before sending another verification email.', retryAfterSeconds)
    }
  }

  await invalidateEmailVerificationTokens(executor, userId)

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + tokenLifetimeMilliseconds)
  const [result] = await executor.execute(
    `INSERT INTO email_verification_tokens (user_id, token_hash, email_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [userId, hash(token), hash(email), expiresAt],
  )

  return { token, verificationId: result.insertId }
}

export async function completeEmailVerification(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 128) {
    throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
  }

  let connection
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()

    const [tokens] = await connection.execute(
      `SELECT verification_id, user_id, email_hash, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [hash(token)],
    )
    const verification = tokens[0]

    if (!verification || verification.used_at || new Date(verification.expires_at).getTime() <= Date.now()) {
      throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
    }

    const [users] = await connection.execute(
      'SELECT user_id, email FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [verification.user_id],
    )
    const user = users[0]
    const currentEmailHash = user?.email ? hash(user.email) : null

    if (!currentEmailHash || !timingSafeEqual(currentEmailHash, verification.email_hash)) {
      throw new EmailVerificationError(400, 'This verification link is invalid or has expired.')
    }

    await connection.execute(
      'UPDATE users SET email_verified_at = CURRENT_TIMESTAMP(3) WHERE user_id = ?',
      [user.user_id],
    )
    await connection.execute(
      `UPDATE email_verification_tokens
       SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
       WHERE user_id = ? AND used_at IS NULL`,
      [user.user_id],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'USER_EMAIL_VERIFIED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `Recovery email verified for user ${user.user_id}`],
    )
    await connection.commit()
    return { userId: user.user_id }
  } catch (error) {
    if (connection) await connection.rollback()
    throw error
  } finally {
    connection?.release()
  }
}

export async function revokeEmailVerificationToken(verificationId) {
  await pool.execute(
    `UPDATE email_verification_tokens
     SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP(3))
     WHERE verification_id = ?`,
    [verificationId],
  )
}
