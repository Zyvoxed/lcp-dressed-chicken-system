import pool from '../config/database.js'
import { environment } from '../config/environment.js'
import {
  createMfaChallengeId,
  createMfaOtp,
  hashMfaChallengeId,
  hashMfaEmail,
  hashMfaOtp,
  hashMfaRateIdentifier,
  verifyMfaOtp,
} from './loginMfaSecurity.js'

const maximumAttempts = 5
const resendCooldownSeconds = 60
const secret = () => process.env.JWT_SECRET || ''

export class LoginMfaError extends Error {
  constructor(status, message, retryAfterSeconds = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function newCode() {
  return createMfaOtp(environment.mfa.otpLength)
}

function dateBucket(windowSeconds) {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000
  return new Date(bucket)
}

async function consumeLimit(connection, action, kind, value, maximum, windowSeconds) {
  if (kind === 'ip') {
    await connection.execute(
      `DELETE FROM login_mfa_rate_limits
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
       LIMIT 500`,
    )
  }
  const hash = hashMfaRateIdentifier(kind, value || '<unknown>', secret())
  const bucketStart = dateBucket(windowSeconds)
  await connection.execute(
    `INSERT INTO login_mfa_rate_limits (action, identifier_kind, identifier_hash, window_started_at, request_count, created_at)
     VALUES (?, ?, ?, ?, 1, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
    [action, kind, hash, bucketStart],
  )
  const [rows] = await connection.execute(
    `SELECT request_count FROM login_mfa_rate_limits
     WHERE action = ? AND identifier_kind = ? AND identifier_hash = ? AND window_started_at = ?
     LIMIT 1`,
    [action, kind, hash, bucketStart],
  )
  if (Number(rows[0]?.request_count || 0) > maximum) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucketStart.getTime() + windowSeconds * 1000 - Date.now()) / 1000))
    throw new LoginMfaError(429, 'Too many sign-in attempts. Please try again later.', retryAfterSeconds)
  }
}

async function withTransaction(work) {
  const connection = await pool.getConnection()
  let active = false
  try {
    await connection.beginTransaction()
    active = true
    const result = await work(connection)
    await connection.commit()
    active = false
    return result
  } catch (error) {
    if (active) await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function enforceLoginRateLimits({ username, ipAddress }) {
  return withTransaction(async (connection) => {
    await consumeLimit(connection, 'login', 'ip', ipAddress, 30, 15 * 60)
    await consumeLimit(connection, 'login', 'account', String(username || '').trim().toLowerCase(), 10, 15 * 60)
  })
}

export async function createLoginChallenge(user, ipAddress) {
  const id = createMfaChallengeId()
  const idHash = hashMfaChallengeId(id)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  await withTransaction(async (connection) => {
    await consumeLimit(connection, 'challenge', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'challenge', 'account', String(user.user_id), 5, 60 * 60)
    await connection.execute(
      `DELETE FROM login_mfa_challenges
       WHERE created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
       LIMIT 500`,
    )
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
       WHERE user_id = ? AND consumed_at IS NULL`,
      [user.user_id],
    )
    await connection.execute(
      `INSERT INTO login_mfa_challenges
         (challenge_hash, user_id, auth_version, email_hash, otp_hash, expires_at, resend_available_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
      [idHash, user.user_id, Number(user.auth_version || 0), hashMfaEmail(user.email, secret()), otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds],
    )
  })
  return {
    challengeId: id,
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}

export async function consumeLoginChallenge({ challengeId, code, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const submittedCode = typeof code === 'string' ? code : ''

  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'verify', 'ip', ipAddress, 60, 15 * 60)
    await consumeLimit(connection, 'verify', 'challenge', idHash.toString('hex'), 15, 15 * 60)
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, auth_version, email_hash, otp_hash, expires_at, attempts, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This verification code is invalid or has expired.') }
    }

    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }

    const matches = verifyMfaOtp(challenge.otp_hash, idHash, submittedCode, secret())
    if (!matches) {
      const attempts = Number(challenge.attempts) + 1
      await connection.execute(
        `UPDATE login_mfa_challenges
         SET attempts = ?, consumed_at = IF(? >= ?, UTC_TIMESTAMP(3), consumed_at)
         WHERE challenge_id = ?`,
        [attempts, attempts, maximumAttempts, challenge.challenge_id],
      )
      if (attempts >= maximumAttempts) {
        return { failure: new LoginMfaError(429, 'Maximum verification attempts reached. Return to login to request a new code.') }
      }
      return { failure: new LoginMfaError(400, 'The verification code is incorrect.') }
    }

    const [users] = await connection.execute(
      `SELECT user_id, fullname, username, role, is_active, email, email_verified_at, auth_version
       FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user || !user.is_active || !user.email || !user.email_verified_at || !['Admin', 'Staff'].includes(user.role)) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (Number(user.auth_version || 0) !== Number(challenge.auth_version || 0)) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account credentials changed. Return to login and try again.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    await connection.execute(
      'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ? AND consumed_at IS NULL',
      [challenge.challenge_id],
    )
    return user
  })
  if (result?.failure) throw result.failure
  return result
}

export async function resendLoginChallenge({ challengeId, ipAddress }) {
  const rawId = typeof challengeId === 'string' ? challengeId : ''
  const idHash = hashMfaChallengeId(rawId)
  const code = newCode()
  const otpHash = hashMfaOtp(idHash, code, secret())
  const result = await withTransaction(async (connection) => {
    await consumeLimit(connection, 'resend', 'ip', ipAddress, 30, 60 * 60)
    await consumeLimit(connection, 'resend', 'challenge', idHash.toString('hex'), 10, 60 * 60)
    const [challenges] = await connection.execute(
      `SELECT challenge_id, user_id, email_hash, expires_at, resend_available_at, consumed_at,
              expires_at <= UTC_TIMESTAMP(3) AS expired,
              resend_available_at <= UTC_TIMESTAMP(3) AS resend_ready,
              GREATEST(1, CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), resend_available_at) / 1000000)) AS retry_after
       FROM login_mfa_challenges WHERE challenge_hash = ? LIMIT 1 FOR UPDATE`,
      [idHash],
    )
    const challenge = challenges[0]
    if (!challenge || challenge.consumed_at) {
      return { failure: new LoginMfaError(400, 'This login verification request is invalid or has expired.') }
    }
    const [users] = await connection.execute(
      `SELECT email, is_active, email_verified_at FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [challenge.user_id],
    )
    const user = users[0]
    if (!user?.is_active || !user.email || !user.email_verified_at) {
      return { failure: new LoginMfaError(403, 'This account needs an active, verified email address. Contact an administrator.') }
    }
    if (!Buffer.from(challenge.email_hash).equals(hashMfaEmail(user.email, secret()))) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'Your account email changed. Return to login and try again.') }
    }
    if (challenge.expired) {
      await connection.execute(
        'UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3) WHERE challenge_id = ?',
        [challenge.challenge_id],
      )
      return { failure: new LoginMfaError(400, 'This verification code has expired. Return to login and try again.') }
    }
    if (!challenge.resend_ready) {
      return { failure: new LoginMfaError(429, 'Please wait before requesting another code.', Number(challenge.retry_after)) }
    }
    await connection.execute(
      `UPDATE login_mfa_challenges
       SET otp_hash = ?, attempts = 0,
           expires_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE),
           resend_available_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
       WHERE challenge_id = ?`,
      [otpHash, environment.mfa.otpExpiryMinutes, resendCooldownSeconds, challenge.challenge_id],
    )
    return { email: user.email }
  })
  if (result?.failure) throw result.failure
  return {
    ...result,
    code,
    expiresAt: new Date(Date.now() + environment.mfa.otpExpiryMinutes * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + resendCooldownSeconds * 1000).toISOString(),
  }
}

export async function invalidateLoginChallenge(challengeId) {
  await pool.execute(
    `UPDATE login_mfa_challenges
     SET consumed_at = COALESCE(consumed_at, UTC_TIMESTAMP(3))
     WHERE challenge_hash = ?`,
    [hashMfaChallengeId(typeof challengeId === 'string' ? challengeId : '')],
  )
}
