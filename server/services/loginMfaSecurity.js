import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export function createMfaChallengeId() {
  return randomBytes(32).toString('base64url')
}

export function hashMfaChallengeId(challengeId) {
  return createHash('sha256').update(challengeId).digest()
}

export function createMfaOtp(length = 6) {
  return String(randomInt(0, 10 ** length)).padStart(length, '0')
}

export function hashMfaOtp(challengeHash, code, secret) {
  return createHmac('sha256', secret).update(challengeHash).update(':').update(code).digest()
}

export function hashMfaRateIdentifier(kind, value, secret) {
  return createHmac('sha256', secret).update(`${kind}:${value}`).digest()
}

export function hashMfaEmail(email, secret) {
  return hashMfaRateIdentifier('email', String(email || '').trim().toLowerCase(), secret)
}

export function verifyMfaOtp(expectedHash, challengeHash, submittedCode, secret) {
  if (typeof submittedCode !== 'string' || !/^[0-9]{6}$/.test(submittedCode)) return false
  const expected = Buffer.from(expectedHash)
  const actual = hashMfaOtp(challengeHash, submittedCode, secret)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
