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
  resolveMfaSmtpConfig,
} = await import('../services/emailDeliveryService.js')

const frontendUrl = 'https://lcp.example.test'
const fromEmail = 'sender@gmail.com'

function mockDelivery(logger = { error() {} }) {
  const messages = []
  const delivery = createEmailDelivery({
    transporter: {
      async sendMail(message) { messages.push(message) },
    },
    frontendUrl,
    fromEmail,
    logger,
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

test('MFA prefers dedicated Gmail credentials when configured', () => {
  const config = resolveMfaSmtpConfig({
    gmail: { user: 'mfa@gmail.com', appPassword: 'mfa-app-password' },
    smtp: { host: 'smtp.other-provider.test', port: 587, user: 'recovery@example.test', appPassword: 'recovery-password' },
  })

  assert.deepEqual(config, {
    host: 'smtp.gmail.com',
    port: 465,
    user: 'mfa@gmail.com',
    appPassword: 'mfa-app-password',
  })
})

test('MFA reuses existing delivery credentials only when the configured SMTP host is Gmail', () => {
  const config = resolveMfaSmtpConfig({
    gmail: { user: '', appPassword: '' },
    smtp: { host: ' SMTP.GMAIL.COM ', port: 465, user: 'sender@gmail.com', appPassword: 'abcd efgh ijkl mnop' },
  })

  assert.deepEqual(config, {
    host: 'smtp.gmail.com',
    port: 465,
    user: 'sender@gmail.com',
    appPassword: 'abcdefghijklmnop',
  })
})

test('MFA does not use non-Gmail recovery SMTP credentials', () => {
  assert.throws(() => resolveMfaSmtpConfig({
    gmail: { user: '', appPassword: '' },
    smtp: { host: 'smtp.other-provider.test', port: 587, user: 'sender@example.test', appPassword: 'smtp-app-password' },
  }), { message: 'Gmail MFA delivery is not configured' })
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

test('login MFA email sends the code, expiry, and anti-sharing warning through mocked delivery', async () => {
  const { delivery, messages } = mockDelivery()
  await delivery.sendLoginMfaCode({ email: 'admin@example.com', code: '091274', expiryMinutes: 5 })

  assert.equal(messages.length, 1)
  assert.equal(messages[0].to, 'admin@example.com')
  assert.equal(messages[0].subject, 'LCP Dressed Chicken Trading — Login Verification Code')
  assert.match(messages[0].text, /091274/)
  assert.match(messages[0].text, /expires in 5 minutes/)
  assert.match(messages[0].text, /Do not share/)
  assert.match(messages[0].text, /did not initiate this login/)
})

test('SMTP provider errors are replaced with a safe generic error', async () => {
  const logs = []
  const delivery = createEmailDelivery({
    transporter: {
      async sendMail() {
        const error = new Error('provider response includes secret-token and recipient@example.com')
        error.code = 'EAUTH'
        error.responseCode = 535
        error.command = 'AUTH PLAIN secret-token'
        throw error
      },
    },
    frontendUrl,
    fromEmail,
    logger: { error(...args) { logs.push(args) } },
  })

  await assert.rejects(
    delivery.sendPasswordReset({ email: 'staff@example.com', token: 'reset-token' }),
    { message: 'Password reset email could not be sent' },
  )
  assert.deepEqual(logs, [[
    'Email delivery failed',
    { operation: 'password_reset', category: 'authentication', code: 'EAUTH', responseCode: 535 },
  ]])
  assert.equal(JSON.stringify(logs).includes('secret-token'), false)
  assert.equal(JSON.stringify(logs).includes('recipient@example.com'), false)
})

test('SMTP diagnostics classify connection errors and timeouts without provider message text', async () => {
  for (const [code, expectedCategory] of [['ECONNECTION', 'connection'], ['ETIMEDOUT', 'timeout']]) {
    const logs = []
    const delivery = createEmailDelivery({
      transporter: {
        async sendMail() {
          const error = new Error('private provider response')
          error.code = code
          error.command = 'CONN'
          throw error
        },
      },
      frontendUrl,
      fromEmail,
      logger: { error(...args) { logs.push(args) } },
    })

    await assert.rejects(delivery.sendLoginMfaCode({ email: 'owner@example.com', code: '012345' }), {
      message: 'Login verification email could not be sent',
    })
    assert.deepEqual(logs[0][1], {
      operation: 'login_mfa', category: expectedCategory, code, command: 'CONN',
    })
    assert.equal(JSON.stringify(logs).includes('private provider response'), false)
  }
})
