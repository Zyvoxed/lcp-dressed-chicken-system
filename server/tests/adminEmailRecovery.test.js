import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { AdminEmailRecoveryError, recoverAdminEmail } from '../services/adminEmailRecoveryService.js'

function makeDatabase(user) {
  const calls = []
  const state = { commits: 0, rollbacks: 0, released: 0 }
  const connection = {
    async beginTransaction() {},
    async commit() { state.commits += 1 },
    async rollback() { state.rollbacks += 1 },
    release() { state.released += 1 },
    async execute(sql, values = []) {
      calls.push({ sql, values })
      if (sql.includes('SELECT user_id, username, role, is_active')) return [[user]]
      if (sql.includes('SELECT user_id FROM users WHERE email')) return [[]]
      return [{ affectedRows: 1, insertId: 44 }]
    },
  }
  return {
    calls,
    state,
    async getConnection() { return connection },
  }
}

const account = {
  user_id: 8,
  username: 'owner',
  role: 'Admin',
  is_active: 1,
  email: 'old@example.com',
  email_verified_at: new Date(),
}

test('operator recovery only selects an active Admin and cannot recover Staff', async () => {
  const database = makeDatabase({ ...account, role: 'Staff' })
  let sent = false
  await assert.rejects(
    recoverAdminEmail({
      username: 'owner', email: 'new@example.com', operator: 'case-123', database,
      deliverVerification: async () => { sent = true },
    }),
    (error) => error instanceof AdminEmailRecoveryError && error.status === 404,
  )
  assert.equal(sent, false)
  assert.equal(database.state.rollbacks, 1)
  assert.equal(database.calls.some(({ sql }) => sql.startsWith('UPDATE users')), false)
})

test('operator recovery changes the email to unverified, invalidates sessions, and audits the action', async () => {
  const database = makeDatabase(account)
  const issued = []
  const revoked = []
  const sent = []
  const result = await recoverAdminEmail({
    username: 'owner',
    email: '  new@example.com ',
    operator: 'case-123',
    database,
    invalidateTokens: async (_connection, userId) => issued.push({ invalidatedUserId: userId }),
    issueToken: async (_connection, userId, email) => {
      issued.push({ userId, email })
      return { verificationId: 44, token: 'verification-only-secret' }
    },
    revokeToken: async (id) => revoked.push(id),
    deliverVerification: async (message) => sent.push(message),
  })

  const update = database.calls.find(({ sql }) => sql.includes('UPDATE users'))
  const audit = database.calls.find(({ sql }) => sql.includes('ADMIN_EMAIL_RECOVERY_REQUESTED'))
  assert.deepEqual(update.values, ['new@example.com', account.user_id])
  assert.match(update.sql, /email_verified_at = NULL/)
  assert.match(update.sql, /auth_version = auth_version \+ 1/)
  assert.ok(audit)
  assert.match(audit.sql, /VALUES \(NULL, 'ADMIN_EMAIL_RECOVERY_REQUESTED'/)
  assert.match(audit.values[0], /case-123/)
  assert.equal(database.state.commits, 1)
  assert.deepEqual(sent, [{ email: 'new@example.com', token: 'verification-only-secret' }])
  assert.equal(result.userId, account.user_id)
  assert.equal(Object.hasOwn(result, 'token'), false)
  assert.deepEqual(revoked, [])
})

test('Admin recovery never marks an email verified when delivery fails', async () => {
  const database = makeDatabase(account)
  const revoked = []
  await assert.rejects(
    recoverAdminEmail({
      username: 'owner', email: 'new@example.com', operator: 'case-124', database,
      issueToken: async () => ({ verificationId: 45, token: 'not-returned' }),
      revokeToken: async (id) => revoked.push(id),
      deliverVerification: async () => { throw new Error('provider detail') },
    }),
    (error) => error instanceof AdminEmailRecoveryError && error.status === 502,
  )
  const update = database.calls.find(({ sql }) => sql.includes('UPDATE users'))
  assert.match(update.sql, /email_verified_at = NULL/)
  assert.equal(update.sql.includes('email_verified_at = CURRENT_TIMESTAMP'), false)
  assert.deepEqual(revoked, [45])
})

test('initial Admin bootstrap requires an email and uses the existing verification flow', async () => {
  const script = await readFile(new URL('../scripts/createAdmin.js', import.meta.url), 'utf8')
  assert.match(script, /ADMIN_EMAIL/)
  assert.match(script, /INSERT INTO users \(fullname, username, email, password, role, contact_number\)/)
  assert.match(script, /issueEmailVerificationToken/)
  assert.match(script, /sendEmailVerification/)
  assert.match(script, /email_verified_at is required|email verification required/i)
  assert.doesNotMatch(script, /email_verified_at\s*=\s*CURRENT_TIMESTAMP/i)
  assert.doesNotMatch(script, /jwt\.sign/)
})

test('legacy integration scripts mark only their synthetic JWT fixtures MFA-verified', async () => {
  for (const scriptPath of [
    '../scripts/predeployTransactionTest.js',
    '../scripts/productCreationTest.js',
    '../scripts/supplierIntegrationTest.js',
  ]) {
    const script = await readFile(new URL(scriptPath, import.meta.url), 'utf8')
    assert.match(script, /mfa_verified:\s*true/, `${scriptPath} is missing the test-only MFA claim`)
  }
})
