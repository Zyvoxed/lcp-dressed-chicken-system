import pool from '../config/database.js'
import {
  completeEmailVerification,
  EmailVerificationError,
  issueEmailVerificationToken,
  revokeEmailVerificationToken,
} from '../services/emailVerificationService.js'
import { sendEmailVerification } from '../services/emailDeliveryService.js'

function positiveId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new EmailVerificationError(400, 'Invalid user ID')
  return id
}

export async function verifyEmail(request, response) {
  try {
    await completeEmailVerification(request.body?.token)
    return response.json({ success: true, message: 'Recovery email verified successfully.' })
  } catch (error) {
    if (error instanceof EmailVerificationError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to verify recovery email:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to verify recovery email' })
  }
}

export async function resendEmailVerification(request, response) {
  let connection
  try {
    const userId = positiveId(request.params.id)
    connection = await pool.getConnection()
    await connection.beginTransaction()

    const [users] = await connection.execute(
      'SELECT user_id, email, email_verified_at FROM users WHERE user_id = ? LIMIT 1 FOR UPDATE',
      [userId],
    )
    const user = users[0]
    if (!user) throw new EmailVerificationError(404, 'User not found')
    if (!user.email) throw new EmailVerificationError(400, 'Add a recovery email before sending verification.')
    if (user.email_verified_at) throw new EmailVerificationError(400, 'This recovery email is already verified.')

    const issued = await issueEmailVerificationToken(connection, user.user_id, user.email)
    await connection.commit()
    connection.release()
    connection = null

    try {
      await sendEmailVerification({ email: user.email, ...issued })
    } catch (error) {
      await revokeEmailVerificationToken(issued.verificationId)
      throw error
    }

    return response.json({ success: true, message: 'Verification email sent.' })
  } catch (error) {
    if (connection) await connection.rollback()
    if (error instanceof EmailVerificationError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to send verification email:', error.message)
    return response.status(502).json({ success: false, message: 'Unable to send verification email. Please try again.' })
  } finally {
    connection?.release()
  }
}
