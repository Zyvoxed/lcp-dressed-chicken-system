import 'dotenv/config'
import bcrypt from 'bcrypt'
import pool from '../config/database.js'
import {
  issueEmailVerificationToken,
  normalizeRecoveryEmail,
  validateRecoveryEmail,
} from '../services/emailVerificationService.js'
import { sendEmailVerification } from '../services/emailDeliveryService.js'
import { revokeEmailVerificationToken } from '../services/emailVerificationService.js'

async function createAdmin() {
  const fullname = process.env.ADMIN_FULLNAME?.trim()
  const username = process.env.ADMIN_USERNAME?.trim()
  const email = normalizeRecoveryEmail(process.env.ADMIN_EMAIL)
  const password = process.env.ADMIN_INITIAL_PASSWORD
  const contactNumber = process.env.ADMIN_CONTACT?.trim() || null

  if (!fullname || !username || !email || !password) {
    throw new Error('ADMIN_FULLNAME, ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_INITIAL_PASSWORD are required')
  }
  validateRecoveryEmail(email)

  const connection = await pool.getConnection()
  let verification
  let userId
  try {
    await connection.beginTransaction()
    const [existingUsers] = await connection.execute(
      'SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1 FOR UPDATE',
      [username, email],
    )
    if (existingUsers.length > 0) {
      throw new Error('An account already uses that Admin username or email. No account was created.')
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const [result] = await connection.execute(
      `INSERT INTO users (fullname, username, email, password, role, contact_number)
       VALUES (?, ?, ?, ?, 'Admin', ?)`,
      [fullname, username, email, passwordHash, contactNumber],
    )
    userId = result.insertId
    verification = await issueEmailVerificationToken(connection, userId, email)
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'ADMIN_PROVISIONED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [userId, `Initial Admin ${username} provisioned; email verification required`],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  try {
    await sendEmailVerification({ email, token: verification.token })
  } catch {
    await revokeEmailVerificationToken(verification.verificationId)
    throw new Error(`Admin ${username} was created without verified email. Configure SMTP and use the controlled admin email recovery procedure to send a verification link.`)
  }

  console.log(`Initial Admin ${username} was created. Verify the email link before signing in.`)
}

try {
  await createAdmin()
} catch (error) {
  console.error('Unable to create initial Admin:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
