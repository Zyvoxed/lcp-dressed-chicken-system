import 'dotenv/config'
import bcrypt from 'bcrypt'
import pool from '../config/database.js'

const saltRounds = 10

async function createAdmin() {
  const fullname = process.env.ADMIN_FULLNAME?.trim()
  const username = process.env.ADMIN_USERNAME?.trim()
  const password = process.env.ADMIN_PASSWORD
  const contactNumber = process.env.ADMIN_CONTACT?.trim() || null

  if (!fullname || !username || !password) {
    throw new Error('ADMIN_FULLNAME, ADMIN_USERNAME, and ADMIN_PASSWORD are required')
  }

  const [existingUsers] = await pool.execute(
    'SELECT user_id FROM users WHERE username = ? LIMIT 1',
    [username],
  )

  if (existingUsers.length > 0) {
    console.log('An account with that username already exists. No Admin was created.')
    return
  }

  const passwordHash = await bcrypt.hash(password, saltRounds)

  await pool.execute(
    `INSERT INTO users (fullname, username, password, role, contact_number)
     VALUES (?, ?, ?, 'Admin', ?)`,
    [fullname, username, passwordHash, contactNumber],
  )

  console.log('Development Admin created successfully.')
}

try {
  await createAdmin()
} catch (error) {
  console.error('Unable to create development Admin:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
