import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertRestrictedTestDatabaseGrants,
  assertEmptyTestDatabase,
  getIsolatedTestDatabaseConfig,
  removeSchemaSelection,
  assertSelectedTestDatabase,
} from '../scripts/testDatabaseSafety.js'

const safeEnvironment = {
  TEST_DB_CONFIRMATION: 'I_UNDERSTAND_THIS_TEST_DATABASE_MUST_BE_EMPTY',
  TEST_DB_HOST: '127.0.0.1',
  TEST_DB_PORT: '3306',
  TEST_DB_USER: 'lcp_test_runner',
  TEST_DB_PASSWORD: 'test-only-password',
  TEST_DB_NAME: 'lcp_test_phase1',
  DB_USER: 'application_user',
  DB_NAME: 'lcp_business_system',
  DB_PASSWORD: 'application-password',
}

test('integration test database config requires explicit local isolated target', () => {
  assert.equal(getIsolatedTestDatabaseConfig(safeEnvironment).database, 'lcp_test_phase1')
  assert.throws(() => getIsolatedTestDatabaseConfig({}), /test-only confirmation/)
  assert.throws(() => getIsolatedTestDatabaseConfig({
    ...safeEnvironment,
    TEST_DB_HOST: 'mysql-production.aivencloud.com',
  }), /local test MySQL host/)
  assert.throws(() => getIsolatedTestDatabaseConfig({
    ...safeEnvironment,
    TEST_DB_HOST: 'mysql.example.com',
  }), /local test MySQL host/)
  assert.throws(() => getIsolatedTestDatabaseConfig({
    ...safeEnvironment,
    TEST_DB_NAME: 'lcp_business_system',
  }), /dedicated lcp_test_/)
  for (const overrides of [
    { TEST_DB_CONFIRMATION: '' },
    { TEST_DB_HOST: 'mysql-production.aivencloud.com' },
    { TEST_DB_HOST: '192.168.1.10' },
    { TEST_DB_NAME: 'lcp_business_system' },
    { TEST_DB_USER: 'production_user' },
    { TEST_DB_USER: 'application_user' },
    { TEST_DB_PASSWORD: '' },
    { TEST_DB_PASSWORD: 'application-password' },
    { TEST_DB_NAME: 'LCP_TEST_PHASE1' },
  ]) {
    assert.throws(() => getIsolatedTestDatabaseConfig({ ...safeEnvironment, ...overrides }))
  }
})

test('integration scripts verify the active schema matches the explicit test schema', async () => {
  const connection = {
    async execute() {
      return [[{ selected_database: 'lcp_test_phase1' }]]
    },
  }
  await assert.doesNotReject(() => assertSelectedTestDatabase(connection, 'lcp_test_phase1'))
  await assert.rejects(
    () => assertSelectedTestDatabase(connection, 'lcp_test_other'),
    /does not match the explicitly configured test database/,
  )
})

test('test database account must have privileges only within its test schema', () => {
  const scopedGrant = 'GRANT ALL PRIVILEGES ON `lcp_test_phase1`.* TO `lcp_test_runner`@`localhost`'
  assert.doesNotThrow(() => assertRestrictedTestDatabaseGrants([
    { grant: 'GRANT USAGE ON *.* TO `lcp_test_runner`@`localhost`' },
    { grant: scopedGrant },
  ], 'lcp_test_phase1'))
  assert.throws(() => assertRestrictedTestDatabaseGrants([
    { grant: 'GRANT ALL PRIVILEGES ON *.* TO `lcp_test_runner`@`localhost`' },
    { grant: scopedGrant },
  ], 'lcp_test_phase1'), /global privileges/)
  assert.throws(() => assertRestrictedTestDatabaseGrants([
    { grant: 'GRANT ALL PRIVILEGES ON `lcp_test_phase1`.* TO `lcp_test_runner`@`localhost`' },
    { grant: 'GRANT SELECT ON `lcp_business_system`.* TO `lcp_test_runner`@`localhost`' },
  ], 'lcp_test_phase1'), /only on its dedicated test schema/)
  assert.throws(() => assertRestrictedTestDatabaseGrants([
    { grant: 'GRANT ALL PRIVILEGES ON `lcp_test_phase1`.* TO `lcp_test_runner`@`localhost`' },
    { grant: '`test_admin`@`%` TO `lcp_test_runner`@`localhost`' },
  ], 'lcp_test_phase1'), /only on its dedicated test schema/)
  assert.throws(() => assertRestrictedTestDatabaseGrants([
    { grant: 'GRANT ALL PRIVILEGES ON `lcp_test_phase1`.* TO `lcp_test_runner`@`localhost` WITH GRANT OPTION' },
  ], 'lcp_test_phase1'), /must not be able to grant privileges/)
})

test('test schema bootstrap removes only the production schema selection statements', () => {
  const schema = 'CREATE DATABASE IF NOT EXISTS lcp_business_system;\nUSE lcp_business_system;\nCREATE TABLE test_table (id INT);'
  assert.equal(removeSchemaSelection(schema), 'CREATE TABLE test_table (id INT);')
})

test('test schema must contain no database objects before integration setup', async () => {
  const statements = []
  const connection = {
    async execute(statement, values) {
      statements.push({ statement, values })
      return [[{ object_count: 0 }]]
    },
  }
  await assertEmptyTestDatabase(connection, 'lcp_test_phase1')
  assert.match(statements[0].statement, /information_schema\.routines/)
  assert.match(statements[0].statement, /information_schema\.triggers/)
  assert.match(statements[0].statement, /information_schema\.events/)
  assert.deepEqual(statements[0].values, Array(4).fill('lcp_test_phase1'))
  await assert.rejects(() => assertEmptyTestDatabase({
    async execute() {
      return [[{ object_count: 1 }]]
    },
  }, 'lcp_test_phase1'), /not empty/)
})
