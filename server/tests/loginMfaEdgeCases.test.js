import assert from 'node:assert/strict'
import test from 'node:test'
import bcrypt from 'bcrypt'
import express from 'express'
import jwt from 'jsonwebtoken'
import nodemailer from 'nodemailer'

process.env.NODE_ENV = 'test'
process.env.DB_HOST ||= '127.0.0.1'
process.env.DB_PORT ||= '1'
process.env.DB_USER ||= 'lcp_mfa_edge_test'
process.env.DB_NAME ||= 'lcp_mfa_edge_test'
process.env.DB_SSL = 'false'
process.env.JWT_SECRET ||= 'synthetic-mfa-edge-tests-only-secret'
process.env.SMTP_HOST = 'smtp.gmail.com'
process.env.SMTP_PORT = '465'
process.env.SMTP_USER = 'mfa-test@example.invalid'
process.env.SMTP_APP_PASSWORD = 'synthetic-not-a-real-secret'
process.env.SMTP_FROM_EMAIL = 'mfa-test@example.invalid'

const [{ default: pool }, { default: authRoutes }, { default: authenticate }, loginMfaService, { hashMfaChallengeId, hashMfaRateIdentifier }] = await Promise.all([
  import('../config/database.js'),
  import('../routes/authRoutes.js'),
  import('../middleware/authenticate.js'),
  import('../services/loginMfaService.js'),
  import('../services/loginMfaSecurity.js'),
])

const secret = process.env.JWT_SECRET

function testUser({ id = 10, username = 'test-operator', role = 'Admin', active = 1, verified = true } = {}) {
  return {
    user_id: id,
    fullname: 'Test Operator',
    username,
    role,
    password: '',
    is_active: active,
    auth_version: 3,
    email: `${username}@example.invalid`,
    email_verified_at: verified ? new Date('2026-01-01T00:00:00Z') : null,
  }
}

function createState(users = [testUser()]) {
  return {
    users: new Map(users.map((user) => [user.user_id, user])),
    challenges: new Map(),
    rateLimits: new Map(),
    emails: [],
    activity: [],
    nextChallengeId: 1,
    lockTail: Promise.resolve(),
  }
}

function installDatabase(state) {
  const originalExecute = pool.execute
  const originalGetConnection = pool.getConnection
  const originalTransport = nodemailer.createTransport
  let connectionSequence = 0

  pool.execute = async (sql, values = []) => {
    const query = sql.replace(/\s+/g, ' ').trim()
    if (query.startsWith('SELECT user_id, fullname, username, password, role, is_active, auth_version')) {
      const user = [...state.users.values()].find((entry) => entry.username === values[0])
      return [user ? [{ ...user }] : []]
    }
    if (query.startsWith('SELECT role, is_active, auth_version FROM users')) {
      const user = state.users.get(Number(values[0]))
      return [user ? [{ role: user.role, is_active: user.is_active, auth_version: user.auth_version }] : []]
    }
    if (query.startsWith('SELECT user_id, fullname, username, role, is_active FROM users')) {
      const user = state.users.get(Number(values[0]))
      return [user ? [{ ...user }] : []]
    }
    if (query.startsWith('INSERT INTO activity_logs')) {
      state.activity.push({ values: [...values] })
      return [{ insertId: state.activity.length }]
    }
    if (query.startsWith('UPDATE login_mfa_challenges SET consumed_at = COALESCE')) {
      for (const challenge of state.challenges.values()) {
        if (challenge.user_id === Number(values[0]) && challenge.consumed_at === null) challenge.consumed_at = new Date()
      }
      return [{ affectedRows: 1 }]
    }
    if (query.startsWith('UPDATE login_mfa_challenges SET consumed_at = COALESCE')) return [{ affectedRows: 1 }]
    throw new Error(`Unexpected pool query: ${query}`)
  }

  pool.getConnection = async () => {
    const connectionId = ++connectionSequence
    let releaseLock
    let working = null
    const connection = {
      async beginTransaction() {
        const previous = state.lockTail
        state.lockTail = new Promise((resolve) => { releaseLock = resolve })
        await previous
        working = {
          challenges: structuredClone(state.challenges),
          rateLimits: structuredClone(state.rateLimits),
          nextChallengeId: state.nextChallengeId,
        }
      },
      async commit() {
        state.challenges = working.challenges
        state.rateLimits = working.rateLimits
        state.nextChallengeId = working.nextChallengeId
        working = null
        releaseLock?.()
      },
      async rollback() {
        working = null
        releaseLock?.()
      },
      release() {},
      async execute(sql, values = []) {
        const query = sql.replace(/\s+/g, ' ').trim()
        if (query.startsWith('DELETE FROM login_mfa_rate_limits')) return [{ affectedRows: 0 }]
        if (query.startsWith('INSERT INTO login_mfa_rate_limits')) {
          const [action, kind, hash, bucket] = values
          const key = `${action}:${kind}:${Buffer.from(hash).toString('hex')}:${new Date(bucket).getTime()}`
          const row = working.rateLimits.get(key) || { action, kind, hash: Buffer.from(hash), bucket: new Date(bucket), request_count: 0 }
          row.request_count += 1
          working.rateLimits.set(key, row)
          return [{ affectedRows: 1 }]
        }
        if (query.startsWith('SELECT request_count FROM login_mfa_rate_limits')) {
          const [action, kind, hash, bucket] = values
          const key = `${action}:${kind}:${Buffer.from(hash).toString('hex')}:${new Date(bucket).getTime()}`
          const row = working.rateLimits.get(key)
          return [row ? [{ request_count: row.request_count }] : []]
        }
        if (query.startsWith('DELETE FROM login_mfa_challenges')) return [{ affectedRows: 0 }]
        if (query.startsWith('UPDATE login_mfa_challenges SET consumed_at = COALESCE')) {
          const userId = Number(values[0])
          for (const challenge of working.challenges.values()) {
            if (challenge.user_id === userId && challenge.consumed_at === null) challenge.consumed_at = new Date()
          }
          return [{ affectedRows: 1 }]
        }
        if (query.startsWith('INSERT INTO login_mfa_challenges')) {
          const [idHash, userId, authVersion, emailHash, otpHash, expiryMinutes] = values
          const challengeId = working.nextChallengeId++
          const now = Date.now()
          const id = Buffer.from(idHash).toString('hex')
          working.challenges.set(id, {
            challenge_id: challengeId,
            challenge_hash: Buffer.from(idHash),
            user_id: Number(userId),
            auth_version: Number(authVersion),
            email_hash: Buffer.from(emailHash),
            otp_hash: Buffer.from(otpHash),
            expires_at: new Date(now + Number(expiryMinutes) * 60_000),
            attempts: 0,
            consumed_at: null,
          })
          return [{ insertId: challengeId }]
        }
        if (query.startsWith('SELECT challenge_id, user_id, auth_version')) {
          const challenge = working.challenges.get(Buffer.from(values[0]).toString('hex'))
          if (!challenge) return [[]]
          return [[{
            ...challenge,
            expired: Number(challenge.expires_at.getTime() <= Date.now()),
          }]]
        }
        if (query.startsWith('SELECT user_id, fullname, username, role, is_active, email, email_verified_at, auth_version')) {
          const user = state.users.get(Number(values[0]))
          return [user ? [{ ...user }] : []]
        }
        if (query.startsWith('UPDATE login_mfa_challenges SET attempts =')) {
          const [attempts, , maximumAttempts, challengeId] = values
          const row = [...working.challenges.values()].find((item) => item.challenge_id === Number(challengeId))
          if (!row) return [{ affectedRows: 0 }]
          row.attempts = Number(attempts)
          if (row.attempts >= Number(maximumAttempts)) row.consumed_at = new Date()
          return [{ affectedRows: 1 }]
        }
        if (query.startsWith('UPDATE login_mfa_challenges SET consumed_at = UTC_TIMESTAMP(3)')) {
          const row = [...working.challenges.values()].find((item) => item.challenge_id === Number(values[0]))
          if (row) row.consumed_at = new Date()
          return [{ affectedRows: row ? 1 : 0 }]
        }
        throw new Error(`Unexpected transaction query #${connectionId}: ${query}`)
      },
    }
    return connection
  }

  nodemailer.createTransport = () => ({
    async sendMail(message) { state.emails.push(message); return { accepted: [message.to] } },
  })

  return () => {
    pool.execute = originalExecute
    pool.getConnection = originalGetConnection
    nodemailer.createTransport = originalTransport
  }
}

function countFor(state, action, kind, value, bucket) {
  const expectedHash = hashMfaRateIdentifier(kind, value, secret).toString('hex')
  return [...state.rateLimits.values()].find((row) => row.action === action
    && row.kind === kind
    && Buffer.from(row.hash).toString('hex') === expectedHash
    && row.bucket.getTime() === bucket.getTime())?.request_count || 0
}

test('login rate limits enforce 10 account and 30 IP attempts per fixed 15-minute bucket', async () => {
  const state = createState()
  const restore = installDatabase(state)
  const originalNow = Date.now
  const start = Date.UTC(2026, 10, 22, 12, 7)
  Date.now = () => start
  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await loginMfaService.enforceLoginRateLimits({ username: 'Test-Operator', ipAddress: '192.0.2.10' })
    }
    await assert.rejects(
      loginMfaService.enforceLoginRateLimits({ username: 'test-operator', ipAddress: '192.0.2.10' }),
      (error) => error.status === 429,
    )
    const bucket = new Date(Date.UTC(2026, 10, 22, 12, 0))
    assert.equal(countFor(state, 'login', 'account', 'test-operator', bucket), 10)
    assert.equal(countFor(state, 'login', 'ip', '192.0.2.10', bucket), 10)

    await loginMfaService.enforceLoginRateLimits({ username: 'other-account', ipAddress: '192.0.2.10' })
    assert.equal(countFor(state, 'login', 'account', 'other-account', bucket), 1)
    assert.equal(countFor(state, 'login', 'ip', '192.0.2.10', bucket), 11)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await loginMfaService.enforceLoginRateLimits({ username: `account-${attempt}`, ipAddress: '192.0.2.20' })
    }
    await assert.rejects(
      loginMfaService.enforceLoginRateLimits({ username: 'account-30', ipAddress: '192.0.2.20' }),
      (error) => error.status === 429,
    )
    assert.equal(countFor(state, 'login', 'ip', '192.0.2.20', bucket), 30)

    Date.now = () => start + 15 * 60_000
    await loginMfaService.enforceLoginRateLimits({ username: 'test-operator', ipAddress: '192.0.2.10' })
    const nextBucket = new Date(Date.UTC(2026, 10, 22, 12, 15))
    assert.equal(countFor(state, 'login', 'account', 'test-operator', nextBucket), 1)
  } finally {
    Date.now = originalNow
    restore()
  }
})

test('MFA challenge creation uses a five-minute code, a 60-second resend cooldown, and a five-per-account hourly limit', async () => {
  const state = createState()
  const restore = installDatabase(state)
  try {
    const user = state.users.get(10)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const challenge = await loginMfaService.createLoginChallenge(user, '192.0.2.50')
      assert.equal(challenge.code.length, 6)
      assert.ok(new Date(challenge.expiresAt).getTime() - Date.now() <= 5 * 60_000)
      assert.ok(new Date(challenge.resendAvailableAt).getTime() - Date.now() <= 60_000)
    }
    await assert.rejects(
      loginMfaService.createLoginChallenge(user, '192.0.2.50'),
      (error) => error.status === 429,
    )
    const bucket = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000)
    assert.equal(countFor(state, 'challenge', 'account', '10', bucket), 5)
    assert.equal(state.challenges.size, 5)

    for (let userId = 100; userId < 130; userId += 1) {
      await loginMfaService.createLoginChallenge({ user_id: userId, auth_version: 0, email: `u${userId}@example.invalid` }, '192.0.2.51')
    }
    await assert.rejects(
      loginMfaService.createLoginChallenge({ user_id: 130, auth_version: 0, email: 'u130@example.invalid' }, '192.0.2.51'),
      (error) => error.status === 429,
    )
    assert.equal(countFor(state, 'challenge', 'ip', '192.0.2.51', bucket), 30)
  } finally { restore() }
})

test('MFA verification permits 60 requests per IP per 15-minute window and rejects the next request', async () => {
  const state = createState()
  const restore = installDatabase(state)
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await assert.rejects(
        loginMfaService.consumeLoginChallenge({
          challengeId: `unknown-challenge-${attempt}`,
          code: '000000',
          ipAddress: '192.0.2.80',
        }),
        (error) => error.status === 400,
      )
    }
    await assert.rejects(
      loginMfaService.consumeLoginChallenge({ challengeId: 'unknown-challenge-over-limit', code: '000000', ipAddress: '192.0.2.80' }),
      (error) => error.status === 429,
    )
    const bucket = new Date(Math.floor(Date.now() / (15 * 60_000)) * (15 * 60_000))
    assert.equal(countFor(state, 'verify', 'ip', '192.0.2.80', bucket), 60)
  } finally { restore() }
})

test('concurrent verification consumes a challenge once and returns at most one authenticated user', async () => {
  const state = createState()
  const restore = installDatabase(state)
  try {
    const user = state.users.get(10)
    const issued = await loginMfaService.createLoginChallenge(user, '192.0.2.60')
    const results = await Promise.allSettled([
      loginMfaService.consumeLoginChallenge({ challengeId: issued.challengeId, code: issued.code, ipAddress: '192.0.2.60' }),
      loginMfaService.consumeLoginChallenge({ challengeId: issued.challengeId, code: issued.code, ipAddress: '192.0.2.60' }),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
    const challenge = state.challenges.get(hashMfaChallengeId(issued.challengeId).toString('hex'))
    assert.ok(challenge.consumed_at)
  } finally { restore() }
})

test('HTTP login requires verified email and password, then MFA verification is required before protected access', async () => {
  const passwordHash = await bcrypt.hash('Test-Passphrase-Only', 4)
  const user = testUser()
  user.password = passwordHash
  const state = createState([user])
  const restore = installDatabase(state)
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRoutes)
  app.get('/api/protected', authenticate, (request, response) => response.json({ user_id: request.user.user_id }))
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const origin = `http://127.0.0.1:${server.address().port}`
    const loginRequest = (body) => fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })

    const invalidCredentials = await loginRequest({ username: user.username, password: 'incorrect' })
    const invalidBody = await invalidCredentials.json()
    assert.equal(invalidCredentials.status, 401)
    assert.deepEqual(invalidBody, { success: false, message: 'Invalid username or password' })
    assert.equal(Object.hasOwn(invalidBody, 'token'), false)
    assert.equal(state.challenges.size, 0)

    const challengeResponse = await loginRequest({ username: user.username, password: 'Test-Passphrase-Only' })
    const challengeBody = await challengeResponse.json()
    assert.equal(challengeResponse.status, 200)
    assert.equal(challengeBody.success, true)
    assert.ok(challengeBody.challengeId)
    assert.equal(Object.hasOwn(challengeBody, 'token'), false)
    assert.equal(Object.hasOwn(challengeBody, 'code'), false)
    assert.equal(state.emails.length, 1)

    const protectedWithoutToken = await fetch(`${origin}/api/protected`)
    assert.equal(protectedWithoutToken.status, 401)

    const noMfaToken = jwt.sign({ user_id: user.user_id, role: user.role, auth_version: user.auth_version }, secret)
    const protectedWithoutMfaClaim = await fetch(`${origin}/api/protected`, {
      headers: { Authorization: `Bearer ${noMfaToken}` },
    })
    assert.equal(protectedWithoutMfaClaim.status, 401)

    const otp = state.emails[0].text.match(/code is (\d{6})/)?.[1]
    assert.ok(otp)
    const verify = (code) => fetch(`${origin}/api/auth/login/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challengeBody.challengeId, code }),
    })
    const wrongOtp = otp === '999999' ? '999998' : '999999'
    const failedVerification = await verify(wrongOtp)
    const failedBody = await failedVerification.json()
    assert.equal(failedVerification.status, 400)
    assert.equal(Object.hasOwn(failedBody, 'token'), false)
    const challengeIdHash = hashMfaChallengeId(challengeBody.challengeId).toString('hex')
    assert.equal(state.challenges.get(challengeIdHash).attempts, 1)
    assert.equal(state.challenges.get(challengeIdHash).consumed_at, null)

    const successfulVerification = await verify(otp)
    const successfulBody = await successfulVerification.json()
    assert.equal(successfulVerification.status, 200)
    const authenticatedClaims = jwt.verify(successfulBody.token, secret)
    assert.equal(authenticatedClaims.mfa_verified, true)
    assert.equal(authenticatedClaims.user_id, user.user_id)
    assert.equal(authenticatedClaims.exp - authenticatedClaims.iat, 8 * 60 * 60)
    assert.ok(state.challenges.get(challengeIdHash).consumed_at)

    const protectedWithToken = await fetch(`${origin}/api/protected`, {
      headers: { Authorization: `Bearer ${successfulBody.token}` },
    })
    assert.equal(protectedWithToken.status, 200)
    assert.deepEqual(await protectedWithToken.json(), { user_id: user.user_id })

    const reusedChallenge = await verify(otp)
    assert.equal(reusedChallenge.status, 400)
    assert.equal(Object.hasOwn(await reusedChallenge.json(), 'token'), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    restore()
  }
})

test('a challenge ID and OTP from another user cannot be combined to authenticate', async () => {
  const firstUser = testUser({ id: 10, username: 'first-user' })
  const secondUser = testUser({ id: 11, username: 'second-user' })
  const state = createState([firstUser, secondUser])
  const restore = installDatabase(state)
  try {
    const first = await loginMfaService.createLoginChallenge(firstUser, '192.0.2.70')
    const second = await loginMfaService.createLoginChallenge(secondUser, '192.0.2.70')
    await assert.rejects(
      loginMfaService.consumeLoginChallenge({ challengeId: first.challengeId, code: second.code, ipAddress: '192.0.2.70' }),
      (error) => error.status === 400,
    )
    assert.equal(state.challenges.get(hashMfaChallengeId(first.challengeId).toString('hex')).attempts, 1)
    assert.equal(state.challenges.get(hashMfaChallengeId(second.challengeId).toString('hex')).attempts, 0)
  } finally { restore() }
})
