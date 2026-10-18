import {
  completePasswordReset,
  PasswordResetError,
  passwordResetConfirmation,
  preparePasswordReset,
  revokePasswordResetToken,
} from '../services/passwordResetService.js'
import { sendPasswordReset } from '../services/emailDeliveryService.js'

const minimumResponseMilliseconds = 700

function requestIp(request) {
  const forwarded = request.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.ip || request.socket?.remoteAddress || '<unknown>'
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function requestPasswordReset(request, response) {
  const startedAt = Date.now()
  response.set('Cache-Control', 'no-store')

  try {
    const reset = await preparePasswordReset(request.body?.email, requestIp(request))

    if (reset) {
      try {
        await sendPasswordReset(reset)
      } catch {
        try { await revokePasswordResetToken(reset.resetId) } catch { /* The token expires and remains unusable. */ }
      }
    }

    const remainingDelay = minimumResponseMilliseconds - (Date.now() - startedAt)
    if (remainingDelay > 0) await delay(remainingDelay)
    return response.json({ success: true, message: passwordResetConfirmation })
  } catch (error) {
    console.error('Unable to process password reset request:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to process the request. Please try again.' })
  }
}

export async function resetPassword(request, response) {
  response.set('Cache-Control', 'no-store')
  try {
    await completePasswordReset(request.body?.token, request.body?.password, requestIp(request))
    return response.json({ success: true, message: 'Password changed successfully. You can now sign in.' })
  } catch (error) {
    if (error instanceof PasswordResetError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to reset password:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to reset password. Please try again.' })
  }
}
