import assert from 'node:assert/strict'
import test from 'node:test'
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
