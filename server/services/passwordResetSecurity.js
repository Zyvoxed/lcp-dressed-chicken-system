import { createHash, createHmac, randomBytes } from 'node:crypto'

export const minimumPasswordLength = 8
export const maximumPasswordLength = 72

export function normalizeResetEmail(value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

export function validateNewPassword(value) {
  if (typeof value !== 'string' || value.length < minimumPasswordLength || value.length > maximumPasswordLength) {
    throw new Error(`Password must be between ${minimumPasswordLength} and ${maximumPasswordLength} characters`)
  }

  if (Buffer.byteLength(value, 'utf8') > maximumPasswordLength) {
    throw new Error(`Password must be between ${minimumPasswordLength} and ${maximumPasswordLength} characters`)
  }

  return value
}

export function createResetToken() {
  return randomBytes(32).toString('base64url')
}

export function hashResetToken(token) {
  return createHash('sha256').update(token).digest()
}

export function hashRateLimitIdentifier(kind, value, secret) {
  return createHmac('sha256', secret).update(`${kind}:${value}`).digest()
}
