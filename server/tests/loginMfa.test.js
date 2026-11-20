import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import jwt from 'jsonwebtoken'

process.env.NODE_ENV = 'test'
process.env.DB_HOST ||= 'localhost'
process.env.DB_PORT ||= '3306'
process.env.DB_USER ||= 'unit-test'
process.env.DB_NAME ||= 'unit-test'
process.env.DB_SSL = 'false'
process.env.JWT_SECRET ||= 'unit-test-secret-for-login-mfa'

const {
  createMfaChallengeId,
  createMfaOtp,
  hashMfaChallengeId,
  hashMfaEmail,
  hashMfaOtp,
  hashMfaRateIdentifier,
  verifyMfaOtp,
} = await import('../services/loginMfaSecurity.js')
const { sessionMatchesMfa } = await import('../services/authSessionService.js')
const pool = (await import('../config/database.js')).default
const { createUser } = await import('../controllers/userController.js')
const { verifyLoginMfa } = await import('../controllers/authController.js')
const {
  consumeLoginChallenge,
  createLoginChallenge,
  enforceLoginRateLimits,
  LoginMfaError,
  resendLoginChallenge,
} = await import('../services/loginMfaService.js')

function challengeFixture(role = 'Admin') {
  const id = createMfaChallengeId()
  const idHash = hashMfaChallengeId(id)
  const code = '012345'
  return {
    id,
    idHash,
    code,
    challenge: {
      challenge_id: 1,
      user_id: 4,
      auth_version: 2,
      email_hash: hashMfaEmail('test@example.com', process.env.JWT_SECRET),
      otp_hash: hashMfaOtp(idHash, code, process.env.JWT_SECRET),
      attempts: 0,
      consumed_at: null,
      expired: 0,
    },
    user: {
      user_id: 4,
      fullname: 'Test User',
      username: 'test-user',
      role,
      is_active: 1,
      email: 'test@example.com',
      email_verified_at: new Date(),
      auth_version: 2,
    },
  }
}

function installConnection(fixture) {
  const state = { challenge: fixture.challenge, user: fixture.user, committed: 0, updates: [] }
  const connection = {
    async beginTransaction() {},
    async commit() { state.committed += 1 },
    async rollback() {},
    release() {},
    async execute(sql, values) {
      if (sql.includes('INSERT INTO login_mfa_rate_limits')) return [{ affectedRows: 1 }]
      if (sql.includes('SELECT request_count FROM login_mfa_rate_limits')) return [[{ request_count: 1 }]]
      if (sql.includes('SELECT challenge_id, user_id, auth_version')) {
        return Buffer.from(values[0]).equals(fixture.idHash) ? [[state.challenge]] : [[]]
      }
      if (sql.includes('SELECT user_id, fullname, username, role')) return [[state.user]]
      if (sql.includes('SET attempts =')) {
        state.challenge.attempts = values[0]
        if (values[1] >= values[2]) state.challenge.consumed_at = new Date()
        state.updates.push({ sql, values })
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('SET consumed_at')) {
        state.challenge.consumed_at = new Date()
        state.updates.push({ sql, values })
        return [{ affectedRows: 1 }]
      }
      return [[], []]
    },
  }
  const previous = pool.getConnection
  pool.getConnection = async () => connection
  return {
    state,
    restore() { pool.getConnection = previous },
  }
}

test('MFA identifiers and OTPs are cryptographically random and stored as hashes', () => {
  const firstId = createMfaChallengeId()
  const secondId = createMfaChallengeId()
  assert.notEqual(firstId, secondId)
  assert.match(firstId, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(createMfaOtp().length, 6)
  assert.match(createMfaOtp(), /^[0-9]{6}$/)
  const challengeHash = hashMfaChallengeId(firstId)
  const otpHash = hashMfaOtp(challengeHash, '012345', process.env.JWT_SECRET)
  assert.equal(challengeHash.length, 32)
  assert.equal(otpHash.length, 32)
  assert.notEqual(otpHash.toString('hex'), '012345')
  assert.equal(verifyMfaOtp(otpHash, challengeHash, '012345', process.env.JWT_SECRET), true)
  assert.equal(verifyMfaOtp(otpHash, challengeHash, '012346', process.env.JWT_SECRET), false)
  assert.equal(verifyMfaOtp(otpHash, challengeHash, '12345', process.env.JWT_SECRET), false)
  assert.notDeepEqual(hashMfaRateIdentifier('ip', 'same', 'secret'), hashMfaRateIdentifier('account', 'same', 'secret'))
})

for (const role of ['Admin', 'Staff']) {
  test(`${role} account completes MFA and returns its existing role`, async () => {
    const fixture = challengeFixture(role)
    const mock = installConnection(fixture)
    try {
      const user = await consumeLoginChallenge({ challengeId: fixture.id, code: fixture.code, ipAddress: '127.0.0.1' })
      assert.equal(user.role, role)
      assert.equal(mock.state.challenge.consumed_at instanceof Date, true)
      assert.equal(mock.state.committed, 1)
    } finally {
      mock.restore()
    }
  })
}

test('failed OTP attempts are committed and the fifth attempt consumes the challenge', async () => {
  const fixture = challengeFixture()
  const mock = installConnection(fixture)
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await assert.rejects(
        consumeLoginChallenge({ challengeId: fixture.id, code: '999999', ipAddress: '127.0.0.1' }),
        (error) => error instanceof LoginMfaError && error.status === (attempt === 5 ? 429 : 400),
      )
    }
    assert.equal(mock.state.challenge.attempts, 5)
    assert.ok(mock.state.challenge.consumed_at)
    assert.equal(mock.state.committed, 5)
  } finally {
    mock.restore()
  }
})

test('expired and already consumed challenges cannot authenticate', async () => {
  for (const fixtureState of [
    { expired: 1, consumed_at: null },
    { expired: 0, consumed_at: new Date() },
  ]) {
    const fixture = challengeFixture()
    Object.assign(fixture.challenge, fixtureState)
    const mock = installConnection(fixture)
    try {
      await assert.rejects(
        consumeLoginChallenge({ challengeId: fixture.id, code: fixture.code, ipAddress: '127.0.0.1' }),
        (error) => error instanceof LoginMfaError && error.status === 400,
      )
      assert.equal(mock.state.committed, 1)
    } finally {
      mock.restore()
    }
  }
})

test('missing and invalid challenge identifiers cannot verify a correct OTP', async () => {
  for (const challengeId of [undefined, 'not-the-issued-challenge']) {
    const fixture = challengeFixture()
    const mock = installConnection(fixture)
    try {
      await assert.rejects(
        consumeLoginChallenge({ challengeId, code: fixture.code, ipAddress: '127.0.0.1' }),
        (error) => error instanceof LoginMfaError && error.status === 400,
      )
      assert.equal(mock.state.challenge.consumed_at, null)
    } finally {
      mock.restore()
    }
  }
})

test('verification endpoint completes authentication only after the correct challenge and OTP', async () => {
  const fixture = challengeFixture('Staff')
  const mock = installConnection(fixture)
  const previousExecute = pool.execute
  pool.execute = async () => [[], []]
  const response = {
    statusCode: 200,
    payload: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  try {
    await verifyLoginMfa({ body: { challengeId: fixture.id, code: fixture.code }, socket: { remoteAddress: '127.0.0.1' } }, response)
    assert.equal(response.statusCode, 200)
    assert.equal(response.payload.user.role, 'Staff')
    assert.equal(jwt.verify(response.payload.token, process.env.JWT_SECRET).mfa_verified, true)
    assert.equal(mock.state.challenge.consumed_at instanceof Date, true)
  } finally {
    pool.execute = previousExecute
    mock.restore()
  }
})

test('login UI, auth service, and API share the challengeId request and response contract', async () => {
  const [loginForm, authService, authController] = await Promise.all([
    readFile(new URL('../../src/pages/Login/LoginForm.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/services/authService.js', import.meta.url), 'utf8'),
    readFile(new URL('../controllers/authController.js', import.meta.url), 'utf8'),
  ])
  assert.match(loginForm, /onVerifyMfa\(mfaChallenge\.challengeId, otp\)/)
  assert.match(loginForm, /onResendMfa\(mfaChallenge\.challengeId\)/)
  assert.doesNotMatch(loginForm, /challengeToken/)
  assert.match(authService, /challengeId: result\.challengeId/)
  assert.match(authService, /JSON\.stringify\(\{ challengeId, code \}\)/)
  assert.match(authService, /JSON\.stringify\(\{ challengeId \}\)/)
  assert.match(authController, /challengeId: request\.body\?\.challengeId/)
})

test('login rate limits reject requests after the shared threshold', async () => {
  let rollbacks = 0
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { rollbacks += 1 },
    release() {},
    async execute(sql) {
      if (sql.includes('SELECT request_count')) return [[{ request_count: 31 }]]
      return [{ affectedRows: 1 }]
    },
  }
  const previous = pool.getConnection
  pool.getConnection = async () => connection
  try {
    await assert.rejects(
      enforceLoginRateLimits({ username: 'test-user', ipAddress: '127.0.0.1' }),
      (error) => error instanceof LoginMfaError && error.status === 429,
    )
    assert.equal(rollbacks, 1)
  } finally {
    pool.getConnection = previous
  }
})

test('the MFA session gate rejects existing JWTs without the verification claim', () => {
  assert.equal(sessionMatchesMfa({ role: 'Admin' }), false)
  assert.equal(sessionMatchesMfa({ role: 'Staff', mfa_verified: false }), false)
  assert.equal(sessionMatchesMfa({ role: 'Admin', mfa_verified: true }), true)
  assert.equal(sessionMatchesMfa({ role: 'Staff', mfa_verified: true }), true)
})

test('new accounts cannot omit the email address required for MFA', async () => {
  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
  await createUser({
    body: { fullname: 'Test User', username: 'test-user', password: 'temporary', role: 'Staff' },
    user: { user_id: 1 },
  }, response)
  assert.equal(response.statusCode, 400)
  assert.match(response.payload.message, /verified email address is required/i)
})

test('MFA migration and rollback touch only MFA-specific tables', async () => {
  const forward = await readFile(new URL('../../database/migrations/20261119_add_login_mfa.sql', import.meta.url), 'utf8')
  const rollback = await readFile(new URL('../../database/migrations/20261119_add_login_mfa.rollback.sql', import.meta.url), 'utf8')
  assert.deepEqual([...forward.matchAll(/CREATE TABLE\s+([a-z_]+)/gi)].map((match) => match[1]), [
    'login_mfa_challenges',
    'login_mfa_rate_limits',
  ])
  assert.match(forward, /REFERENCES users\(user_id\)/)
  assert.match(forward, /information_schema\.COLUMNS/)
  assert.deepEqual([...rollback.matchAll(/DROP TABLE(?: IF EXISTS)?\s+([a-z_]+)/gi)].map((match) => match[1]), [
    'login_mfa_rate_limits',
    'login_mfa_challenges',
  ])
  assert.match(rollback, /DROP TABLE IF EXISTS login_mfa_rate_limits/)
  assert.match(rollback, /DROP TABLE IF EXISTS login_mfa_challenges/)
  assert.equal(/^\s*(ALTER|UPDATE|DELETE|TRUNCATE)\b/im.test(forward), false)
})

test('challenge start stores no plaintext OTP in its SQL parameters', async () => {
  const savedCalls = []
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, values) {
      savedCalls.push({ sql, values })
      if (sql.includes('SELECT request_count')) return [[{ request_count: 1 }]]
      return [{ affectedRows: 1 }]
    },
  }
  const previous = pool.getConnection
  pool.getConnection = async () => connection
  try {
    const issued = await createLoginChallenge({ user_id: 8, auth_version: 0 }, '127.0.0.1')
    const challengeInsert = savedCalls.find(({ sql }) => sql.includes('INSERT INTO login_mfa_challenges'))
    assert.ok(challengeInsert)
    assert.equal(challengeInsert.values.some((value) => value === issued.code), false)
    assert.equal(Buffer.isBuffer(challengeInsert.values[3]), true)
    assert.equal(Buffer.isBuffer(challengeInsert.values[4]), true)
    assert.equal(issued.code.length, 6)
  } finally {
    pool.getConnection = previous
  }
})

test('resend rotates the OTP hash and extends the expiry after the cooldown', async () => {
  const fixture = challengeFixture()
  fixture.challenge.resend_ready = 1
  fixture.challenge.expired = 0
  const calls = []
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, values) {
      calls.push({ sql, values })
      if (sql.includes('SELECT request_count')) return [[{ request_count: 1 }]]
      if (sql.includes('SELECT challenge_id, user_id, email_hash, expires_at')) {
        return Buffer.from(values[0]).equals(fixture.idHash) ? [[fixture.challenge]] : [[]]
      }
      if (sql.includes('SELECT email, is_active')) return [[fixture.user]]
      return [{ affectedRows: 1 }]
    },
  }
  const previous = pool.getConnection
  pool.getConnection = async () => connection
  try {
    const resent = await resendLoginChallenge({ challengeId: fixture.id, ipAddress: '127.0.0.1' })
    const update = calls.find(({ sql }) => sql.includes('SET otp_hash ='))
    assert.ok(update)
    assert.match(update.sql, /expires_at = DATE_ADD/)
    assert.match(update.sql, /resend_available_at = DATE_ADD/)
    assert.equal(update.values[0].length, 32)
    assert.equal(update.values.includes(resent.code), false)
    assert.equal(resent.email, fixture.user.email)
    assert.ok(new Date(resent.expiresAt).getTime() > Date.now())
  } finally {
    pool.getConnection = previous
  }
})

test('resend honors the server-side cooldown', async () => {
  const fixture = challengeFixture()
  fixture.challenge.resend_ready = 0
  fixture.challenge.expired = 0
  fixture.challenge.retry_after = 35
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes('SELECT request_count')) return [[{ request_count: 1 }]]
      if (sql.includes('SELECT challenge_id, user_id, email_hash, expires_at')) return [[fixture.challenge]]
      if (sql.includes('SELECT email, is_active')) return [[fixture.user]]
      return [{ affectedRows: 1 }]
    },
  }
  const previous = pool.getConnection
  pool.getConnection = async () => connection
  try {
    await assert.rejects(
      resendLoginChallenge({ challengeId: fixture.id, ipAddress: '127.0.0.1' }),
      (error) => error instanceof LoginMfaError && error.status === 429 && error.retryAfterSeconds === 35,
    )
  } finally {
    pool.getConnection = previous
  }
})

test('resend rejects an expired challenge and an invalid challenge identifier', async () => {
  for (const expired of [1, 0]) {
    const fixture = challengeFixture()
    fixture.challenge.expired = expired
    fixture.challenge.resend_ready = 1
    const connection = {
      async beginTransaction() {},
      async commit() {},
      async rollback() {},
      release() {},
      async execute(sql, values) {
        if (sql.includes('SELECT request_count')) return [[{ request_count: 1 }]]
        if (sql.includes('SELECT challenge_id, user_id, email_hash, expires_at')) {
          return Buffer.from(values[0]).equals(fixture.idHash) ? [[fixture.challenge]] : [[]]
        }
        if (sql.includes('SELECT email, is_active')) return [[fixture.user]]
        return [{ affectedRows: 1 }]
      },
    }
    const previous = pool.getConnection
    pool.getConnection = async () => connection
    try {
      const challengeId = expired ? fixture.id : 'invalid-challenge-id'
      await assert.rejects(
        resendLoginChallenge({ challengeId, ipAddress: '127.0.0.1' }),
        (error) => error instanceof LoginMfaError && error.status === 400,
      )
    } finally {
      pool.getConnection = previous
    }
  }
})
