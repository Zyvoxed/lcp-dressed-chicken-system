import mysql from 'mysql2/promise'
import { environment } from './environment.js'

const pool = mysql.createPool({
  host: environment.database.host,
  port: environment.database.port,
  user: environment.database.user,
  password: environment.database.password,
  database: environment.database.name,
  ssl: environment.database.ssl
    ? {
        ca: environment.database.sslCa,
        rejectUnauthorized: true,
      }
    : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

export default pool
