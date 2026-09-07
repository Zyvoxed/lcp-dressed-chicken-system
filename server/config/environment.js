import 'dotenv/config'

const production = process.env.NODE_ENV === 'production'
const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME', 'JWT_SECRET']

if (production) {
  required.push('DB_PASSWORD', 'FRONTEND_URL')
}

const missing = required.filter((name) => !process.env[name]?.trim())

if (missing.length > 0) {
  throw new Error(`Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`)
}

const databasePort = Number(process.env.DB_PORT)
if (!Number.isInteger(databasePort) || databasePort <= 0 || databasePort > 65535) {
  throw new Error('Invalid required environment variable: DB_PORT')
}

if (production && (process.env.JWT_SECRET === 'change_me' || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be a non-placeholder value of at least 32 characters in production')
}

export const environment = {
  production,
  port: Number(process.env.PORT) || 5000,
  frontendUrl: process.env.FRONTEND_URL?.trim() || 'http://localhost:5173',
  database: {
    host: process.env.DB_HOST,
    port: databasePort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME,
  },
}
