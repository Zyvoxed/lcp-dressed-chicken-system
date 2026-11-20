import pool from '../config/database.js'
import {
  invalidateEmailVerificationTokens,
  issueEmailVerificationToken,
  normalizeRecoveryEmail,
  revokeEmailVerificationToken,
  validateRecoveryEmail,
} from './emailVerificationService.js'
import { sendEmailVerification } from './emailDeliveryService.js'

export class AdminEmailRecoveryError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function recoverAdminEmail({
  username,
  email: emailValue,
  operator,
  database = pool,
  invalidateTokens = invalidateEmailVerificationTokens,
  issueToken = issueEmailVerificationToken,
  revokeToken = revokeEmailVerificationToken,
  deliverVerification = sendEmailVerification,
}) {
  const targetUsername = typeof username === 'string' ? username.trim() : ''
  const auditOperator = typeof operator === 'string' ? operator.trim() : ''
  const email = normalizeRecoveryEmail(emailValue)
  if (!targetUsername) throw new AdminEmailRecoveryError(400, 'An exact Admin username is required')
  if (!auditOperator || auditOperator.length > 100) {
    throw new AdminEmailRecoveryError(400, 'A documented operator name or case reference is required')
  }
  if (!email) throw new AdminEmailRecoveryError(400, 'A replacement email address is required')
  validateRecoveryEmail(email)

  const connection = await database.getConnection()
  let verification
  let account
  try {
    await connection.beginTransaction()
    const [rows] = await connection.execute(
      `SELECT user_id, username, role, is_active, email, email_verified_at
       FROM users WHERE username = ? LIMIT 1 FOR UPDATE`,
      [targetUsername],
    )
    account = rows[0]
    if (!account || account.role !== 'Admin' || !account.is_active) {
      throw new AdminEmailRecoveryError(404, 'No active Admin account matched that username')
    }
    if (account.email === email && account.email_verified_at) {
      throw new AdminEmailRecoveryError(409, 'That email is already verified. Use the normal MFA sign-in flow.')
    }

    const [matches] = await connection.execute(
      'SELECT user_id FROM users WHERE email = ? AND user_id <> ? LIMIT 1',
      [email, account.user_id],
    )
    if (matches.length) throw new AdminEmailRecoveryError(409, 'That email address belongs to another account')

    await connection.execute(
      `UPDATE users
       SET email = ?, email_verified_at = NULL, auth_version = auth_version + 1
       WHERE user_id = ? AND role = 'Admin' AND is_active = TRUE`,
      [email, account.user_id],
    )
    await invalidateTokens(connection, account.user_id)
    verification = await issueToken(connection, account.user_id, email)
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (NULL, 'ADMIN_EMAIL_RECOVERY_REQUESTED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [`Out-of-band operator ${auditOperator} initiated email recovery for Admin ${account.username}; verification is pending`],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  try {
    await deliverVerification({ email, token: verification.token })
  } catch {
    await revokeToken(verification.verificationId)
    throw new AdminEmailRecoveryError(502, 'The address was updated but verification email delivery failed. Keep the account unverified and retry through the operator procedure after fixing SMTP.')
  }

  return {
    userId: account.user_id,
    username: account.username,
    message: 'Verification email sent. The Admin account remains unverified until the owner completes the emailed link, then must sign in with MFA.',
  }
}
