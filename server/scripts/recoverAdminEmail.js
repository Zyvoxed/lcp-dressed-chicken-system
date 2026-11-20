import 'dotenv/config'
import pool from '../config/database.js'
import { recoverAdminEmail } from '../services/adminEmailRecoveryService.js'

async function runAdminEmailRecovery() {
  const username = process.env.ADMIN_RECOVERY_USERNAME?.trim() || ''
  const confirmation = process.env.ADMIN_RECOVERY_CONFIRMATION || ''
  const expectedConfirmation = `RECOVER_ADMIN_EMAIL:${username}`
  if (!username || confirmation !== expectedConfirmation) {
    throw new Error(`Set ADMIN_RECOVERY_USERNAME and ADMIN_RECOVERY_CONFIRMATION=${expectedConfirmation} in the controlled operator environment`)
  }

  const result = await recoverAdminEmail({
    username,
    email: process.env.ADMIN_RECOVERY_EMAIL,
    operator: process.env.ADMIN_RECOVERY_OPERATOR,
  })
  console.log(result.message)
}

try {
  await runAdminEmailRecovery()
} catch (error) {
  console.error('Admin email recovery was not completed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
