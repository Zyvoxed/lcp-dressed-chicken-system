import 'dotenv/config'
import pool from '../config/database.js'
import { environment } from '../config/environment.js'
import { runMigrations } from './migrationRunner.js'

const apply = process.argv.includes('--apply')
const confirmation = `APPLY_SCHEMA_MIGRATIONS:${environment.database.name}`
if (apply && process.env.MIGRATION_CONFIRMATION !== confirmation) {
  throw new Error(`Set MIGRATION_CONFIRMATION to ${confirmation} before applying migrations`)
}

let connection
try {
  connection = await pool.getConnection()
  const result = await runMigrations(connection, { apply })
  console.info(`${apply ? 'Migration check' : 'Migration dry run'}: ${result.state} (${result.migrationId})`)
} catch (error) {
  console.error(`Migration failed: ${error.message}`)
  process.exitCode = 1
} finally {
  connection?.release()
  await pool.end()
}
