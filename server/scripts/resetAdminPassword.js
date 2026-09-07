import 'dotenv/config'
import { Writable } from 'node:stream'
import readline from 'node:readline/promises'
import bcrypt from 'bcrypt'
import pool from '../config/database.js'

const minimumPasswordLength = 8

function usernameArgument() {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--username='))
  return argument?.slice('--username='.length).trim() || ''
}

async function askHidden(prompt) {
  process.stdout.write(prompt)
  const mutedOutput = new Writable({ write(_chunk, _encoding, callback) { callback() } })
  const input = readline.createInterface({ input: process.stdin, output: mutedOutput, terminal: true })

  try {
    return await input.question('')
  } finally {
    input.close()
    process.stdout.write('\n')
  }
}

async function resetAdminPassword() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('This command requires an interactive terminal so the password can be entered securely')
  }

  const [admins] = await pool.execute(
    "SELECT user_id, username FROM users WHERE role = 'Admin' ORDER BY username",
  )

  if (admins.length === 0) throw new Error('No existing Admin account was found')

  let username = usernameArgument()
  if (admins.length > 1 && !username) {
    console.log(`Multiple Admin accounts found: ${admins.map((admin) => admin.username).join(', ')}`)
    const input = readline.createInterface({ input: process.stdin, output: process.stdout })
    try {
      username = (await input.question('Enter the exact Admin username to reset: ')).trim()
    } finally {
      input.close()
    }
  }

  const selectedAdmin = username
    ? admins.find((admin) => admin.username === username)
    : admins[0]

  if (!selectedAdmin) throw new Error('The specified username is not an existing Admin account')

  console.log(`Selected Admin: ${selectedAdmin.username}`)
  const password = await askHidden('Enter new password: ')
  const confirmation = await askHidden('Confirm new password: ')

  if (password.length < minimumPasswordLength) {
    throw new Error(`Password must be at least ${minimumPasswordLength} characters`)
  }
  if (password !== confirmation) throw new Error('Passwords do not match')

  const passwordHash = await bcrypt.hash(password, 10)
  const [result] = await pool.execute(
    "UPDATE users SET password = ? WHERE user_id = ? AND role = 'Admin'",
    [passwordHash, selectedAdmin.user_id],
  )

  if (result.affectedRows !== 1) throw new Error('Admin password was not reset')
  console.log('Admin password reset successfully.')
}

try {
  await resetAdminPassword()
} catch (error) {
  console.error(`Unable to reset Admin password: ${error.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
