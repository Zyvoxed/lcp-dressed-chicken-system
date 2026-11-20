import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

test('production config loads with existing SMTP variables and no Gmail aliases', () => {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'mock-user',
    DB_PASSWORD: 'mock-database-password',
    DB_NAME: 'mock-database',
    DB_SSL: 'false',
    JWT_SECRET: 'mock-jwt-secret-long-enough-for-production-test',
    FRONTEND_URL: 'https://lcp.example.test',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '587',
    SMTP_USER: 'mock-sender@gmail.com',
    SMTP_APP_PASSWORD: 'mock-smtp-app-password',
    SMTP_FROM_EMAIL: 'mock-sender@gmail.com',
  }
  delete env.GMAIL_USER
  delete env.GMAIL_APP_PASSWORD

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    'import(process.argv[1]).then(() => process.stdout.write("loaded"))',
    new URL('../config/environment.js', import.meta.url).href,
  ], { cwd: process.cwd(), env, encoding: 'utf8' })

  assert.equal(result.status, 0, 'production configuration should load without Gmail alias variables')
  assert.equal(result.stdout, 'loaded')
})

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

test('MFA uses existing SMTP credentials and sender only when SMTP host is Gmail', () => {
  const config = resolveMfaSmtpConfig({
    host: ' SMTP.GMAIL.COM ',
    port: 587,
    user: 'mock-sender@gmail.com',
    appPassword: 'mock app password',
    fromEmail: 'verified-sender@gmail.com',
  })

  assert.deepEqual(config, {
    host: 'smtp.gmail.com',
    port: 587,
    user: 'mock-sender@gmail.com',
    appPassword: 'mockapppassword',
    fromEmail: 'verified-sender@gmail.com',
  })
})

test('MFA does not use non-Gmail SMTP credentials', () => {
  assert.throws(() => resolveMfaSmtpConfig({
    host: 'smtp.other-provider.test',
    port: 587,
    user: 'mock-user',
    appPassword: 'mock-smtp-app-password',
    fromEmail: 'mock-sender@example.test',
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
