import nodemailer from 'nodemailer'
import { environment } from '../config/environment.js'

const senderName = 'LCP Dressed Chicken Trading'
const safeSmtpCommands = new Set(['CONN', 'CONNECT', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'])

function getEmailErrorDiagnostic(error, operation) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : undefined
  const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : undefined
  const command = typeof error?.command === 'string' && safeSmtpCommands.has(error.command.toUpperCase())
    ? error.command.toUpperCase()
    : undefined
  let category = 'delivery'

  if (error?.message === 'Email delivery is not configured' || error?.message === 'Gmail MFA delivery is not configured') category = 'configuration'
  else if (code === 'EAUTH') category = 'authentication'
  else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') category = 'timeout'
  else if (code && ['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'EDNS'].includes(code)) category = 'connection'
  else if (responseCode >= 500) category = 'smtp_rejected'
  else if (responseCode >= 400) category = 'smtp_temporary'

  return { operation, category, ...(code ? { code } : {}), ...(responseCode ? { responseCode } : {}), ...(command ? { command } : {}) }
}

function logEmailDeliveryFailure(logger, error, operation) {
  try {
    logger.error('Email delivery failed', getEmailErrorDiagnostic(error, operation))
  } catch {
    // Diagnostics must never replace the generic delivery error.
  }
}

function requireEmailConfiguration(smtp, frontendUrl) {
  if (!smtp.host || !smtp.user || !smtp.appPassword || !smtp.fromEmail || !frontendUrl) {
    throw new Error('Email delivery is not configured')
  }
}

export function createSmtpTransportOptions(smtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port !== 465,
    auth: {
      user: smtp.user,
      pass: smtp.appPassword,
    },
    tls: {
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  }
}

export function resolveMfaSmtpConfig({ gmail, smtp }) {
  if (gmail.user && gmail.appPassword) {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      user: gmail.user,
      appPassword: gmail.appPassword,
    }
  }

  // Reuse the existing delivery credentials only when they are explicitly Gmail.
  if (
    smtp.host?.trim().toLowerCase() === 'smtp.gmail.com' &&
    smtp.user &&
    smtp.appPassword
  ) {
    return {
      host: 'smtp.gmail.com',
      port: smtp.port,
      user: smtp.user,
      appPassword: smtp.appPassword.replace(/\s/g, ''),
    }
  }

  throw new Error('Gmail MFA delivery is not configured')
}

export function createEmailDelivery({ transporter, frontendUrl, fromEmail, logger = console }) {
  const from = { name: senderName, address: fromEmail }

  async function deliver(message, failureMessage, operation) {
    try {
      await transporter.sendMail({
        ...message,
        from,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    } catch (error) {
      logEmailDeliveryFailure(logger, error, operation)
      // Do not attach the provider error: it can contain SMTP details or secrets.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(failureMessage)
    }
  }

  return {
    async sendEmailVerification({ email, token }) {
      const verificationUrl = new URL('/verify-email', frontendUrl)
      verificationUrl.hash = new URLSearchParams({ token }).toString()
      const link = verificationUrl.toString()

      await deliver({
        to: email,
        subject: 'Verify your LCP recovery email',
        text: `Verify this email for your LCP account:\n\n${link}\n\nThis link expires in 24 hours. If you did not expect this email, you can ignore it.`,
        html: `<p>Verify this email for your LCP account.</p><p><a href="${link}">Verify recovery email</a></p><p>This link expires in 24 hours. If you did not expect this email, you can ignore it.</p>`,
      }, 'Verification email could not be sent', 'recovery_email_verification')
    },

    async sendPasswordReset({ email, token }) {
      const resetUrl = new URL('/reset-password', frontendUrl)
      resetUrl.hash = new URLSearchParams({ token }).toString()
      const link = resetUrl.toString()

      await deliver({
        to: email,
        subject: 'Reset your LCP account password',
        text: `Use this link to reset your LCP account password:\n\n${link}\n\nThis link expires in 15 minutes. If you did not request this change, you can ignore this email.`,
        html: `<p>Use this link to reset your LCP account password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 15 minutes. If you did not request this change, you can ignore this email.</p>`,
      }, 'Password reset email could not be sent', 'password_reset')
    },

    async sendLoginMfaCode({ email, code, expiryMinutes = 5 }) {
      await deliver({
        to: email,
        subject: 'LCP Dressed Chicken Trading — Login Verification Code',
        text: `Your LCP login verification code is ${code}.\n\nIt expires in ${expiryMinutes} minutes. Do not share this code with anyone. If you did not initiate this login, you can ignore this email and consider changing your password.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937"><h2 style="color:#163832">LCP Dressed Chicken Trading</h2><p>Use this code to finish signing in:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#163832">${code}</p><p>This code expires in ${expiryMinutes} minutes. Do not share it with anyone.</p><p>If you did not initiate this login, you can ignore this email and consider changing your password.</p></div>`,
      }, 'Login verification email could not be sent', 'login_mfa')
    },
  }
}

let emailDelivery

function getEmailDelivery() {
  if (!emailDelivery) {
    try {
      requireEmailConfiguration(environment.smtp, environment.frontendUrl)
      emailDelivery = createEmailDelivery({
        transporter: nodemailer.createTransport(createSmtpTransportOptions(environment.smtp)),
        frontendUrl: environment.frontendUrl,
        fromEmail: environment.smtp.fromEmail,
      })
    } catch (error) {
      logEmailDeliveryFailure(console, error, 'email_delivery_setup')
      // Do not attach initialization errors because they may contain credential details.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Email delivery is not configured')
    }
  }
  return emailDelivery
}

export async function sendEmailVerification(details) {
  return getEmailDelivery().sendEmailVerification(details)
}

export async function sendPasswordReset(details) {
  return getEmailDelivery().sendPasswordReset(details)
}

let mfaEmailDelivery

function getMfaEmailDelivery() {
  if (!mfaEmailDelivery) {
    try {
      const gmailSmtp = resolveMfaSmtpConfig({ gmail: environment.gmail, smtp: environment.smtp })
      mfaEmailDelivery = createEmailDelivery({
        transporter: nodemailer.createTransport(createSmtpTransportOptions(gmailSmtp)),
        frontendUrl: environment.frontendUrl,
        fromEmail: gmailSmtp.user,
      })
    } catch (error) {
      logEmailDeliveryFailure(console, error, 'login_mfa_setup')
      // Do not attach initialization errors because they may contain credential details.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Login verification email could not be sent')
    }
  }
  return mfaEmailDelivery
}

export async function sendLoginMfaCode(details) {
  return getMfaEmailDelivery().sendLoginMfaCode(details)
}
