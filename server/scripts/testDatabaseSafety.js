const testDatabaseConfirmation = 'I_UNDERSTAND_THIS_TEST_DATABASE_MUST_BE_EMPTY'
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1'])
const requiredScopedPrivileges = [
  'ALTER',
  'CREATE',
  'DELETE',
  'DROP',
  'INDEX',
  'INSERT',
  'REFERENCES',
  'SELECT',
  'TRIGGER',
  'UPDATE',
]

export function getIsolatedTestDatabaseConfig(environment = process.env) {
  const config = {
    host: environment.TEST_DB_HOST?.trim().toLowerCase(),
    port: Number(environment.TEST_DB_PORT),
    user: environment.TEST_DB_USER?.trim(),
    password: environment.TEST_DB_PASSWORD,
    database: environment.TEST_DB_NAME?.trim(),
  }
  if (environment.TEST_DB_CONFIRMATION !== testDatabaseConfirmation) {
    throw new Error('Set TEST_DB_CONFIRMATION to the exact test-only confirmation before running this integration test')
  }
  if (!loopbackHosts.has(config.host)) {
    throw new Error('Integration tests require a verified local test MySQL host; remote production hosts are not allowed')
  }
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    throw new Error('TEST_DB_PORT must be a valid MySQL port')
  }
  if (!/^lcp_test_[a-z0-9_]+$/.test(config.database || '')) {
    throw new Error('TEST_DB_NAME must use the dedicated lcp_test_ naming convention')
  }
  if (!/^lcp_test_[a-z0-9_]+$/.test(config.user || '')) {
    throw new Error('TEST_DB_USER must be a dedicated lcp_test_ database account')
  }
  if (!config.password) {
    throw new Error('TEST_DB_PASSWORD is required for the dedicated test database account')
  }
  if (environment.DB_USER?.trim().toLowerCase() === config.user?.toLowerCase()) {
    throw new Error('TEST_DB_USER must be separate from the application database account')
  }
  if (environment.DB_NAME?.trim().toLowerCase() === config.database?.toLowerCase()) {
    throw new Error('The test database must be separate from the configured application database')
  }
  if (environment.DB_PASSWORD && environment.DB_PASSWORD === config.password) {
    throw new Error('TEST_DB_PASSWORD must be separate from the application database password')
  }
  return config
}

export function assertRestrictedTestDatabaseGrants(grants, database) {
  const rows = grants.map((row) => Object.values(row)[0])
  if (rows.some((grant) => /\bWITH GRANT OPTION\b/i.test(grant))) {
    throw new Error('The test database account must not be able to grant privileges to other accounts')
  }
  const globalGrants = rows.filter((grant) => /\bON\s+\*\.\*/i.test(grant))
  if (globalGrants.some((grant) => !/\bGRANT\s+USAGE\s+ON\s+\*\.\*/i.test(grant))) {
    throw new Error('The test database account has global privileges; use an account restricted to the test schema')
  }

  const databasePattern = new RegExp(`\\bON\\s+\`?${database.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`?\\.\\*`, 'i')
  const scopedGrants = rows.filter((grant) => databasePattern.test(grant))
  const otherScopedGrants = rows.filter((grant) => /\bON\s+/.test(grant)
    && !/\bON\s+\*\.\*/i.test(grant)
    && !databasePattern.test(grant))
  const roleGrants = rows.filter((grant) => /\bTO\s+/i.test(grant)
    && !/\bON\s+\*\.\*/i.test(grant)
    && !databasePattern.test(grant))
  if (!scopedGrants.length || otherScopedGrants.length || roleGrants.length) {
    throw new Error('The test database account must have privileges only on its dedicated test schema')
  }

  const joined = scopedGrants.join(' ')
  const missingPrivileges = requiredScopedPrivileges.filter(
    (privilege) => !new RegExp(`\\b${privilege}\\b`, 'i').test(joined),
  )
  if (!/\bALL PRIVILEGES\b/i.test(joined) && missingPrivileges.length) {
    throw new Error(`The test account is missing schema-scoped privileges: ${missingPrivileges.join(', ')}`)
  }
}

export async function assertSelectedTestDatabase(connection, database) {
  const [rows] = await connection.execute('SELECT DATABASE() AS selected_database')
  if (rows[0]?.selected_database !== database) {
    throw new Error('The active MySQL schema does not match the explicitly configured test database')
  }
}

export async function assertEmptyTestDatabase(connection, database) {
  const [objects] = await connection.execute(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ?) +
       (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = ?) +
       (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = ?) +
       (SELECT COUNT(*) FROM information_schema.events WHERE event_schema = ?) AS object_count`,
    [database, database, database, database],
  )
  if (Number(objects[0]?.object_count) !== 0) {
    throw new Error('The test schema is not empty. Refusing to overwrite existing test data; recreate only the isolated test schema manually.')
  }
}

export function removeSchemaSelection(schema) {
  return schema.replace(
    /^\s*CREATE DATABASE IF NOT EXISTS lcp_business_system[\s\S]*?;\s*USE lcp_business_system;\s*/i,
    '',
  )
}
