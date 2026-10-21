import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { sessionMatchesUser } from '../services/authSessionService.js'
import {
  createResetToken,
  hashRateLimitIdentifier,
  hashResetToken,
  maximumPasswordLength,
  minimumPasswordLength,
  normalizeResetEmail,
  validateNewPassword,
} from '../services/passwordResetSecurity.js'
import { getRequestIp } from '../utils/requestIp.js'

async function requestIpThroughExpress(trustedProxies, forwardedFor) {
  const app = express()
  if (trustedProxies.length > 0) app.set('trust proxy', trustedProxies)
  app.get('/ip', (request, response) => response.json({
    requestIp: getRequestIp(request),
    socketIp: request.socket.remoteAddress,
  }))

  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')

  try {
    const { port } = server.address()
    const response = await fetch(`http://127.0.0.1:${port}/ip`, {
      headers: { 'X-Forwarded-For': forwardedFor },
    })
    return response.json()
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('reset tokens are random, URL-safe, and stored as fixed-length hashes', () => {
  const first = createResetToken()
  const second = createResetToken()

  assert.notEqual(first, second)
  assert.match(first, /^[A-Za-z0-9_-]+$/)
  assert.equal(hashResetToken(first).length, 32)
  assert.deepEqual(hashResetToken(first), hashResetToken(first))
  assert.notDeepEqual(hashResetToken(first), hashResetToken(second))
})

test('rate-limit identifiers are normalized and separated by kind', () => {
  const secret = 'unit-test-secret'
  assert.equal(normalizeResetEmail('  Owner@Example.COM '), 'owner@example.com')
  assert.notDeepEqual(
    hashRateLimitIdentifier('email', 'same-value', secret),
    hashRateLimitIdentifier('ip', 'same-value', secret),
  )
})

test('forged forwarded IPs cannot rotate the default password-reset rate-limit identity', async () => {
  const first = await requestIpThroughExpress([], '203.0.113.10')
  const second = await requestIpThroughExpress([], '198.51.100.22')

  assert.equal(first.requestIp, first.socketIp)
  assert.equal(second.requestIp, second.socketIp)
  assert.equal(first.requestIp, second.requestIp)
  assert.notEqual(first.requestIp, '203.0.113.10')
  assert.notEqual(second.requestIp, '198.51.100.22')
})

test('an explicitly trusted reverse proxy can supply the client IP', async () => {
  const forwardedIp = '203.0.113.25'
  const result = await requestIpThroughExpress(['loopback'], forwardedIp)

  assert.equal(result.requestIp, forwardedIp)
})

test('new-password validation accepts only the supported bcrypt length', () => {
  assert.equal(validateNewPassword('a'.repeat(minimumPasswordLength)), 'a'.repeat(minimumPasswordLength))
  assert.equal(validateNewPassword('a'.repeat(maximumPasswordLength)), 'a'.repeat(maximumPasswordLength))
  assert.throws(() => validateNewPassword('a'.repeat(minimumPasswordLength - 1)))
  assert.throws(() => validateNewPassword('a'.repeat(maximumPasswordLength + 1)))
  assert.throws(() => validateNewPassword('🙂'.repeat(20)))
})

test('auth versions preserve legacy sessions until the password changes', () => {
  const activeUser = { role: 'Admin', is_active: 1, auth_version: 0 }
  assert.equal(sessionMatchesUser({ role: 'Admin' }, activeUser), true)
  assert.equal(sessionMatchesUser({ role: 'Admin' }, { ...activeUser, auth_version: 1 }), false)
  assert.equal(sessionMatchesUser({ role: 'Admin', auth_version: 2 }, { ...activeUser, auth_version: 2 }), true)
  assert.equal(sessionMatchesUser({ role: 'Staff', auth_version: 2 }, { ...activeUser, auth_version: 2 }), false)
  assert.equal(sessionMatchesUser({ role: 'Admin', auth_version: 2 }, { ...activeUser, auth_version: 2, is_active: 0 }), false)
})
