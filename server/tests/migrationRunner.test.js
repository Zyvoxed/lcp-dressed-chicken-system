import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runMigrations } from '../scripts/migrationRunner.js'

const coreTables = [
  'users', 'products', 'suppliers', 'customers', 'stock_in', 'sales',
  'sales_items', 'sale_batch_allocations', 'payments', 'activity_logs',
  'idempotency_records', 'email_verification_tokens', 'password_reset_tokens',
  'password_reset_rate_limits',
]
const coreColumns = {
  users: 'user_id fullname username email email_verified_at password role is_active auth_version',
  products: 'product_id product_name selling_price stock_quantity reorder_level status is_active',
  suppliers: 'supplier_id supplier_name is_active',
  customers: 'customer_id customer_name current_balance is_active',
  stock_in: 'stockin_id supplier_id product_id user_id quantity_received remaining_quantity cost_price total_cost delivery_date',
  sales: 'sale_id customer_id user_id payment_type total_amount amount_paid remaining_balance status sale_date',
  sales_items: 'salesitem_id sale_id product_id quantity price subtotal',
  sale_batch_allocations: 'allocation_id salesitem_id stockin_id quantity_deducted cost_price',
  payments: 'payment_id sale_id customer_id user_id payment_amount remaining_balance payment_date',
  activity_logs: 'activity_id user_id action description created_at',
  idempotency_records: 'idempotency_id user_id operation_type idempotency_key request_hash response_status response_body',
  email_verification_tokens: 'verification_id user_id token_hash email_hash expires_at used_at',
  password_reset_tokens: 'reset_id user_id token_hash email_hash expires_at used_at',
  password_reset_rate_limits: 'event_id action identifier_kind identifier_hash created_at',
}
const mfaColumns = {
  login_mfa_challenges: [
    'challenge_hash', 'user_id', 'auth_version', 'email_hash', 'otp_hash',
    'expires_at', 'attempts', 'resend_available_at', 'consumed_at', 'created_at',
  ],
  login_mfa_rate_limits: [
    'action', 'identifier_kind', 'identifier_hash', 'window_started_at', 'request_count', 'created_at',
  ],
}

function connectionFixture({ mfa = [], applied = [], malformed = false } = {}) {
  const tables = new Map([...coreTables.map((name) => [name, 'InnoDB']), ...mfa.map((name) => [name, 'InnoDB'])])
  const statements = []
  const ledger = new Map(applied)
  return {
    statements,
    async query(sql, values = []) {
      statements.push(sql)
      if (sql.includes('SELECT DATABASE()')) return [[{ database_name: 'lcp_test_audit' }]]
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) { tables.set('schema_migrations', 'InnoDB'); return [{}, []] }
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]]
      if (sql.includes('FROM information_schema.TABLES')) return [[...tables].map(([table_name, engine]) => ({ table_name, engine }))]
      if (sql.includes('FROM information_schema.COLUMNS')) {
        const rows = []
        if (values.length > 2) {
          for (const table_name of coreTables) {
            for (const column_name of coreColumns[table_name].split(' ')) {
              rows.push({ table_name, column_name, column_type: table_name === 'users' && column_name === 'user_id' ? 'int' : 'varchar(20)' })
            }
          }
          return [rows]
        }
        for (const [table_name, columns] of Object.entries(mfaColumns)) {
          if (!tables.has(table_name)) continue
          for (const column_name of columns) rows.push({ table_name, column_name })
        }
        if (malformed) rows.pop()
        return [rows]
      }
      if (sql.includes('FROM information_schema.STATISTICS')) {
        return [[
          { table_name: 'login_mfa_challenges', index_name: 'uq_login_mfa_challenge_hash', non_unique: 0 },
          { table_name: 'login_mfa_rate_limits', index_name: 'uq_login_mfa_rate_window', non_unique: 0 },
        ]]
      }
      if (sql.includes('FROM information_schema.TABLE_CONSTRAINTS')) {
        return [[{ table_name: 'login_mfa_challenges', constraint_name: 'fk_login_mfa_challenge_user' }]]
      }
      if (sql.includes('SELECT checksum FROM schema_migrations')) {
        const checksum = ledger.get(values[0])
        return [checksum ? [{ checksum }] : []]
      }
      if (sql.startsWith('CREATE TABLE login_mfa_challenges')) tables.set('login_mfa_challenges', 'InnoDB')
      if (sql.startsWith('CREATE TABLE login_mfa_rate_limits')) tables.set('login_mfa_rate_limits', 'InnoDB')
      return [{}, []]
    },
    async execute(sql, values) {
      statements.push(sql)
      if (sql.startsWith('INSERT INTO schema_migrations')) ledger.set(values[0], values[1])
      return [{ affectedRows: 1 }, []]
    },
  }
}

test('fresh current schema upgrades add only MFA state and record versioned baseline plus migration', async () => {
  const connection = connectionFixture()
  const result = await runMigrations(connection, { apply: true })
  assert.equal(result.state, 'applied')
  assert.equal(connection.statements.filter((sql) => sql.startsWith('CREATE TABLE login_mfa_')).length, 2)
  assert.equal(connection.statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations')).length, 2)
})

test('fresh install schema defines both MFA tables required by application login', async () => {
  const schema = await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8')
  assert.match(schema, /CREATE TABLE login_mfa_challenges\s*\(/)
  assert.match(schema, /CREATE TABLE login_mfa_rate_limits\s*\(/)
  assert.match(schema, /UNIQUE KEY uq_login_mfa_rate_window/)
})

test('existing MFA schema is adopted without recreating tables and reruns are skipped', async () => {
  const connection = connectionFixture({ mfa: Object.keys(mfaColumns) })
  const applied = await runMigrations(connection, { apply: true })
  assert.equal(applied.state, 'applied')
  assert.equal(connection.statements.some((sql) => sql.startsWith('CREATE TABLE login_mfa_')), false)
  const rerun = await runMigrations(connection, { apply: true })
  assert.equal(rerun.state, 'already-applied')
  assert.equal(connection.statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations')).length, 2)
})

test('partial or incompatible MFA schemas stop before recording the migration', async () => {
  const partial = connectionFixture({ mfa: ['login_mfa_challenges'] })
  await assert.rejects(() => runMigrations(partial, { apply: true }), /Only part of the login MFA schema exists/)
  assert.equal(partial.statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations')).length, 1)

  const malformed = connectionFixture({ mfa: Object.keys(mfaColumns), malformed: true })
  await assert.rejects(() => runMigrations(malformed, { apply: true }), /Existing login_mfa_rate_limits schema is incompatible/)
  assert.equal(malformed.statements.filter((sql) => sql.startsWith('INSERT INTO schema_migrations')).length, 1)
})

test('dry run reports missing MFA tables without creating schema or migration records', async () => {
  const connection = connectionFixture()
  const result = await runMigrations(connection)
  assert.equal(result.state, 'login-mfa-pending')
  assert.equal(connection.statements.some((sql) => /CREATE TABLE|INSERT INTO/.test(sql)), false)
})
