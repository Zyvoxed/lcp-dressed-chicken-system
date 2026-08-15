import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import pool from '../config/database.js'

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
    const [users] = await pool.execute(
      `SELECT user_id, fullname, username, password, role, is_active
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

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    )

    pool.execute(
      `INSERT INTO activity_logs (user_id, action, description)
       VALUES (?, 'LOGIN', ?)`,
      [user.user_id, `${user.username} logged in`],
    ).catch((error) => {
      console.error('Unable to record login activity:', error.message)
    })

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
    console.error('Unable to authenticate user:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to complete login',
    })
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
