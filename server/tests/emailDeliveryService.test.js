import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NODE_ENV = 'test'
process.env.DB_HOST ||= 'localhost'
process.env.DB_PORT ||= '3306'
process.env.DB_USER ||= 'unit-test'
process.env.DB_NAME ||= 'unit-test'
process.env.DB_SSL = 'false'
process.env.JWT_SECRET ||= 'unit-test-secret'

const {
  createEmailDelivery,
  createSmtpTransportOptions,
} = await import('../services/emailDeliveryService.js')

const frontendUrl = 'https://lcp.example.test'
const fromEmail = 'sender@gmail.com'

function mockDelivery() {
  const messages = []
  const delivery = createEmailDelivery({
    transporter: {
      async sendMail(message) { messages.push(message) },
    },
    frontendUrl,
    fromEmail,
  })
  return { delivery, messages }
}

test('Gmail SMTP port 465 uses immediate TLS with TLS 1.2 or newer', () => {
  const options = createSmtpTransportOptions({
    host: 'smtp.gmail.com',
    port: 465,
    user: 'sender@gmail.com',
    appPassword: 'test-only-app-password',
  })

  assert.equal(options.secure, true)
  assert.equal(options.requireTLS, false)
  assert.equal(options.tls.minVersion, 'TLSv1.2')
  assert.equal(options.auth.user, 'sender@gmail.com')
})

test('SMTP port 587 requires a STARTTLS upgrade', () => {
  const options = createSmtpTransportOptions({
    host: 'smtp.gmail.com',
    port: 587,
    user: 'sender@gmail.com',
    appPassword: 'test-only-app-password',
  })

  assert.equal(options.secure, false)
  assert.equal(options.requireTLS, true)
})

test('verification email uses the existing URL and expiry without network access', async () => {
  const { delivery, messages } = mockDelivery()
  await delivery.sendEmailVerification({ email: 'owner@example.com', token: 'verification-token' })

  assert.equal(messages.length, 1)
  assert.equal(messages[0].to, 'owner@example.com')
  assert.deepEqual(messages[0].from, { name: 'LCP Dressed Chicken Trading', address: fromEmail })
  assert.match(messages[0].text, /verify-email#token=verification-token/)
  assert.match(messages[0].text, /expires in 24 hours/)
  assert.equal(messages[0].disableFileAccess, true)
  assert.equal(messages[0].disableUrlAccess, true)
})

test('password reset email uses the existing URL and 15-minute expiry without network access', async () => {
  const { delivery, messages } = mockDelivery()
  await delivery.sendPasswordReset({ email: 'staff@example.com', token: 'reset-token' })

  assert.equal(messages.length, 1)
  assert.equal(messages[0].to, 'staff@example.com')
  assert.match(messages[0].text, /reset-password#token=reset-token/)
  assert.match(messages[0].text, /expires in 15 minutes/)
})

test('SMTP provider errors are replaced with a safe generic error', async () => {
  const delivery = createEmailDelivery({
    transporter: {
      async sendMail() { throw new Error('provider response with sensitive details') },
    },
    frontendUrl,
    fromEmail,
  })

  await assert.rejects(
    delivery.sendPasswordReset({ email: 'staff@example.com', token: 'reset-token' }),
    { message: 'Password reset email could not be sent' },
  )
})
