import nodemailer from 'nodemailer'
import { environment } from '../config/environment.js'

const senderName = 'LCP Dressed Chicken Trading'

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

export function createEmailDelivery({ transporter, frontendUrl, fromEmail }) {
  const from = { name: senderName, address: fromEmail }

  async function deliver(message, failureMessage) {
    try {
      await transporter.sendMail({
        ...message,
        from,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    } catch {
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
      }, 'Verification email could not be sent')
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
      }, 'Password reset email could not be sent')
    },
  }
}

let emailDelivery

function getEmailDelivery() {
  if (!emailDelivery) {
    requireEmailConfiguration(environment.smtp, environment.frontendUrl)
    emailDelivery = createEmailDelivery({
      transporter: nodemailer.createTransport(createSmtpTransportOptions(environment.smtp)),
      frontendUrl: environment.frontendUrl,
      fromEmail: environment.smtp.fromEmail,
    })
  }
  return emailDelivery
}

export async function sendEmailVerification(details) {
  return getEmailDelivery().sendEmailVerification(details)
}

export async function sendPasswordReset(details) {
  return getEmailDelivery().sendPasswordReset(details)
}
