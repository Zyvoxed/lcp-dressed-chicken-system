import { createHash } from 'node:crypto'

const migrationId = '20261120_01_login_mfa_schema'
const migrationSql = [
  `CREATE TABLE login_mfa_challenges (
    challenge_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    challenge_hash BINARY(32) NOT NULL,
    user_id INT NOT NULL,
    auth_version INT UNSIGNED NOT NULL,
    email_hash BINARY(32) NOT NULL,
    otp_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    resend_available_at DATETIME(3) NOT NULL,
    consumed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_login_mfa_challenge_hash (challenge_hash),
    KEY idx_login_mfa_user_created (user_id, created_at),
    KEY idx_login_mfa_expiry (expires_at),
    CONSTRAINT fk_login_mfa_challenge_user FOREIGN KEY (user_id)
      REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
  `CREATE TABLE login_mfa_rate_limits (
    rate_limit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    action ENUM('login', 'challenge', 'verify', 'resend') NOT NULL,
    identifier_kind ENUM('ip', 'account', 'challenge') NOT NULL,
    identifier_hash BINARY(32) NOT NULL,
    window_started_at DATETIME(3) NOT NULL,
    request_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_login_mfa_rate_window
      (action, identifier_kind, identifier_hash, window_started_at),
    KEY idx_login_mfa_rate_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`,
]
const checksum = createHash('sha256').update(migrationSql.join('\n')).digest('hex')
const requiredCoreTables = [
  'users', 'products', 'suppliers', 'customers', 'stock_in', 'sales',
  'sales_items', 'sale_batch_allocations', 'payments', 'activity_logs',
  'idempotency_records', 'email_verification_tokens', 'password_reset_tokens',
  'password_reset_rate_limits',
]
const requiredCoreColumns = {
  users: ['user_id', 'fullname', 'username', 'email', 'email_verified_at', 'password', 'role', 'is_active', 'auth_version'],
  products: ['product_id', 'product_name', 'selling_price', 'stock_quantity', 'reorder_level', 'status', 'is_active'],
  suppliers: ['supplier_id', 'supplier_name', 'is_active'],
  customers: ['customer_id', 'customer_name', 'current_balance', 'is_active'],
  stock_in: ['stockin_id', 'supplier_id', 'product_id', 'user_id', 'quantity_received', 'remaining_quantity', 'cost_price', 'total_cost', 'delivery_date'],
  sales: ['sale_id', 'customer_id', 'user_id', 'payment_type', 'total_amount', 'amount_paid', 'remaining_balance', 'status', 'sale_date'],
  sales_items: ['salesitem_id', 'sale_id', 'product_id', 'quantity', 'price', 'subtotal'],
  sale_batch_allocations: ['allocation_id', 'salesitem_id', 'stockin_id', 'quantity_deducted', 'cost_price'],
  payments: ['payment_id', 'sale_id', 'customer_id', 'user_id', 'payment_amount', 'remaining_balance', 'payment_date'],
  activity_logs: ['activity_id', 'user_id', 'action', 'description', 'created_at'],
  idempotency_records: ['idempotency_id', 'user_id', 'operation_type', 'idempotency_key', 'request_hash', 'response_status', 'response_body'],
  email_verification_tokens: ['verification_id', 'user_id', 'token_hash', 'email_hash', 'expires_at', 'used_at'],
  password_reset_tokens: ['reset_id', 'user_id', 'token_hash', 'email_hash', 'expires_at', 'used_at'],
  password_reset_rate_limits: ['event_id', 'action', 'identifier_kind', 'identifier_hash', 'created_at'],
}
const baselineId = 'baseline_current_business_schema_v1'
const baselineChecksum = createHash('sha256').update(requiredCoreTables.join('\n')).digest('hex')
const mfaTables = ['login_mfa_challenges', 'login_mfa_rate_limits']
const requiredColumns = {
  login_mfa_challenges: [
    'challenge_hash', 'user_id', 'auth_version', 'email_hash', 'otp_hash',
    'expires_at', 'attempts', 'resend_available_at', 'consumed_at', 'created_at',
  ],
  login_mfa_rate_limits: [
    'action', 'identifier_kind', 'identifier_hash', 'window_started_at',
    'request_count', 'created_at',
  ],
}

async function tableNames(connection) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()`,
  )
  return new Map(rows.map((row) => [row.table_name, row.engine]))
}

export async function verifyCurrentSchema(connection) {
  const tables = await tableNames(connection)
  const missing = requiredCoreTables.filter((name) => !tables.has(name))
  if (missing.length) {
    throw new Error(`Current application schema is incomplete; missing required tables: ${missing.join(', ')}`)
  }
  const nonTransactional = requiredCoreTables.filter((name) => tables.get(name)?.toLowerCase() !== 'innodb')
  if (nonTransactional.length) {
    throw new Error(`Core application tables must use InnoDB before schema migrations can run: ${nonTransactional.join(', ')}`)
  }
  const [columns] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${requiredCoreTables.map(() => '?').join(', ')})`,
    requiredCoreTables,
  )
  for (const [table, expected] of Object.entries(requiredCoreColumns)) {
    const actual = new Set(columns.filter((column) => column.table_name === table).map((column) => column.column_name))
    const missingColumns = expected.filter((column) => !actual.has(column))
    if (missingColumns.length) {
      throw new Error(`Current application schema is incomplete; ${table} is missing columns: ${missingColumns.join(', ')}`)
    }
  }
  const userIdType = columns.find((column) => column.table_name === 'users' && column.column_name === 'user_id')?.column_type
  if (userIdType !== 'int') throw new Error('users.user_id must be a signed INT before schema migrations can run')
  return tables
}

export async function ensureLoginMfaSchema(connection, existingTables) {
  const present = mfaTables.filter((name) => existingTables.has(name))
  if (present.length === 0) {
    for (const statement of migrationSql) await connection.query(statement)
  } else if (present.length !== mfaTables.length) {
    throw new Error('Only part of the login MFA schema exists; inspect it manually before proceeding')
  }

  const [columns] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
    mfaTables,
  )
  const byTable = new Map(mfaTables.map((table) => [
    table,
    new Set(columns.filter((column) => column.table_name === table).map((column) => column.column_name)),
  ]))
  for (const [table, required] of Object.entries(requiredColumns)) {
    const actual = byTable.get(table)
    const missing = required.filter((column) => !actual?.has(column))
    if (missing.length) throw new Error(`Existing ${table} schema is incompatible; missing columns: ${missing.join(', ')}`)
    if (existingTables.get(table) && existingTables.get(table).toLowerCase() !== 'innodb') {
      throw new Error(`Existing ${table} table must use InnoDB`)
    }
  }
  const [indexes] = await connection.query(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, NON_UNIQUE AS non_unique
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
    mfaTables,
  )
  for (const [table, index] of [
    ['login_mfa_challenges', 'uq_login_mfa_challenge_hash'],
    ['login_mfa_rate_limits', 'uq_login_mfa_rate_window'],
  ]) {
    if (!indexes.some((row) => row.table_name === table && row.index_name === index && Number(row.non_unique) === 0)) {
      throw new Error(`Existing ${table} schema is incompatible; required unique index ${index} is missing`)
    }
  }
  const [foreignKeys] = await connection.query(
    `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name
     FROM information_schema.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    ['login_mfa_challenges'],
  )
  if (!foreignKeys.some((row) => row.constraint_name === 'fk_login_mfa_challenge_user')) {
    throw new Error('Existing login_mfa_challenges schema is incompatible; required user foreign key is missing')
  }
}

export async function runMigrations(connection, { apply = false } = {}) {
  const [databaseRows] = await connection.query('SELECT DATABASE() AS database_name')
  if (!databaseRows[0]?.database_name) throw new Error('Select the target database before running migrations')

  if (apply) {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id VARCHAR(100) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    const [lockRows] = await connection.query("SELECT GET_LOCK('lcp_schema_migrations', 10) AS acquired")
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error('Could not acquire the schema migration lock')
  }

  try {
    const tables = await verifyCurrentSchema(connection)
    const hasLedger = tables.has('schema_migrations')
    if (!apply && !hasLedger) {
      const mfaPresent = mfaTables.filter((table) => tables.has(table)).length
      return { state: mfaPresent === 2 ? 'ready-to-baseline' : mfaPresent === 0 ? 'login-mfa-pending' : 'partial-login-mfa', migrationId }
    }

    const [rows] = await connection.query(
      'SELECT checksum FROM schema_migrations WHERE migration_id = ?',
      [baselineId],
    )
    if (rows[0]?.checksum !== undefined && rows[0].checksum !== baselineChecksum) {
      throw new Error('The recorded current-schema baseline checksum does not match')
    }
    if (!rows[0] && apply) {
      await connection.execute(
        'INSERT INTO schema_migrations (migration_id, checksum) VALUES (?, ?)',
        [baselineId, baselineChecksum],
      )
    }
    const [migrationRows] = await connection.query(
      'SELECT checksum FROM schema_migrations WHERE migration_id = ?',
      [migrationId],
    )
    if (migrationRows[0]) {
      if (migrationRows[0].checksum !== checksum) throw new Error(`Applied migration ${migrationId} has a different checksum`)
      return { state: 'already-applied', migrationId }
    }
    if (!apply) return { state: 'pending', migrationId }

    await ensureLoginMfaSchema(connection, tables)
    await connection.execute(
      'INSERT INTO schema_migrations (migration_id, checksum) VALUES (?, ?)',
      [migrationId, checksum],
    )
    return { state: 'applied', migrationId }
  } finally {
    if (apply) await connection.query("SELECT RELEASE_LOCK('lcp_schema_migrations')")
  }
}
