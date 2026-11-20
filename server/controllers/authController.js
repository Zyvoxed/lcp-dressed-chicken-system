import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import pool from '../config/database.js'
import { environment } from '../config/environment.js'
import { sendLoginMfaCode } from '../services/emailDeliveryService.js'
import {
  consumeLoginChallenge,
  createLoginChallenge,
  enforceLoginRateLimits,
  invalidateLoginChallenge,
  LoginMfaError,
  resendLoginChallenge,
} from '../services/loginMfaService.js'
import { getRequestIp } from '../utils/requestIp.js'

const invalidCredentials = {
  success: false,
  message: 'Invalid username or password',
}

export async function login(request, response) {
  const username = typeof request.body?.username === 'string' ? request.body.username.trim() : ''
  const password = typeof request.body?.password === 'string' ? request.body.password : ''

  if (!username || !password) {
    return response.status(401).json(invalidCredentials)
  }

  try {
    response.set('Cache-Control', 'no-store')
    await enforceLoginRateLimits({ username, ipAddress: getRequestIp(request) })
    const [users] = await pool.execute(
      `SELECT user_id, fullname, username, password, role, is_active, auth_version,
              email, email_verified_at
       FROM users
       WHERE username = ?
       LIMIT 1`,
      [username],
    )
    const user = users[0]

    if (!user) {
      return response.status(401).json(invalidCredentials)
    }

    if (!user.is_active) {
      return response.status(403).json({
        success: false,
        message: 'This account is inactive',
      })
    }

    const passwordMatches = await bcrypt.compare(password, user.password)

    if (!passwordMatches) {
      return response.status(401).json(invalidCredentials)
    }

    if (!user.email || !user.email_verified_at) {
      return response.status(403).json({
        success: false,
        message: 'This account needs an active, verified email address. Contact an administrator.',
      })
    }

    const challenge = await createLoginChallenge(user, getRequestIp(request))
    try {
      await sendLoginMfaCode({
        email: user.email,
        code: challenge.code,
        expiryMinutes: environment.mfa.otpExpiryMinutes,
      })
    } catch {
      await invalidateLoginChallenge(challenge.challengeId)
      return response.status(503).json({
        success: false,
        message: 'Unable to send the verification code. Please try again later.',
      })
    }

    return response.json({
      success: true,
      message: 'A verification code was sent to your registered email address.',
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
    })
  } catch (error) {
    if (error instanceof LoginMfaError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to authenticate user:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to complete login',
    })
  }
}

export async function verifyLoginMfa(request, response) {
  response.set('Cache-Control', 'no-store')
  try {
    const user = await consumeLoginChallenge({
      challengeId: request.body?.challengeId,
      code: request.body?.code,
      ipAddress: getRequestIp(request),
    })
    const token = jwt.sign(
      {
        user_id: user.user_id,
        role: user.role,
        auth_version: Number(user.auth_version || 0),
        mfa_verified: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    )
    pool.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'LOGIN', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [user.user_id, `${user.username} logged in`],
    ).catch((error) => console.error('Unable to record login activity:', error.message))

    return response.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        user_id: user.user_id,
        fullname: user.fullname,
        username: user.username,
        role: user.role,
      },
    })
  } catch (error) {
    if (error instanceof LoginMfaError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to verify login code:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to verify the code. Please try again.' })
  }
}

export async function resendLoginMfa(request, response) {
  response.set('Cache-Control', 'no-store')
  try {
    const challenge = await resendLoginChallenge({
      challengeId: request.body?.challengeId,
      ipAddress: getRequestIp(request),
    })
    try {
      await sendLoginMfaCode({
        email: challenge.email,
        code: challenge.code,
        expiryMinutes: environment.mfa.otpExpiryMinutes,
      })
    } catch {
      await invalidateLoginChallenge(request.body?.challengeId)
      return response.status(503).json({ success: false, message: 'Unable to send the verification code. Return to login and try again.' })
    }
    return response.json({
      success: true,
      message: 'A new verification code was sent.',
      expiresAt: challenge.expiresAt,
      resendAvailableAt: challenge.resendAvailableAt,
    })
  } catch (error) {
    if (error instanceof LoginMfaError) {
      if (error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds))
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to resend login code:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to resend the code. Please try again.' })
  }
}

export async function logout(request, response) {
  try {
    await pool.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'LOGOUT', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, 'User logged out'],
    )

    return response.json({ success: true })
  } catch (error) {
    console.error('Unable to record logout activity:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to record logout activity' })
  }
}

export async function getCurrentUser(request, response) {
  try {
    const [users] = await pool.execute(
      `SELECT user_id, fullname, username, role, is_active
       FROM users
       WHERE user_id = ?
       LIMIT 1`,
      [request.user.user_id],
    )
    const user = users[0]

    if (!user) {
      return response.status(404).json({
        success: false,
        message: 'User not found',
      })
    }

    if (!user.is_active) {
      return response.status(403).json({
        success: false,
        message: 'This account is inactive',
      })
    }

    return response.json({
      success: true,
      user: {
        user_id: user.user_id,
        fullname: user.fullname,
        username: user.username,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Unable to retrieve authenticated user:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to retrieve authenticated user',
    })
  }
}
