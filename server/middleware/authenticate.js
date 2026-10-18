import jwt from 'jsonwebtoken'
import pool from '../config/database.js'
import { sessionMatchesUser } from '../services/authSessionService.js'

export default async function authenticate(request, response, next) {
  const authorization = request.get('Authorization')

  if (!authorization?.startsWith('Bearer ')) {
    return response.status(401).json({
      success: false,
      message: 'Authentication required',
    })
  }

  const token = authorization.slice(7).trim()

  if (!token) {
    return response.status(401).json({
      success: false,
      message: 'Authentication required',
    })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    const [users] = await pool.execute(
      `SELECT role, is_active, auth_version
       FROM users
       WHERE user_id = ?
       LIMIT 1`,
      [payload.user_id],
    )
    const user = users[0]

    if (!sessionMatchesUser(payload, user)) {
      return response.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      })
    }

    request.user = payload
    return next()
  } catch {
    return response.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    })
  }
}
