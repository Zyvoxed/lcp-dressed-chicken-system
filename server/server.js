import 'dotenv/config'
import app from './app.js'
import pool from './config/database.js'
import { environment } from './config/environment.js'
const port = environment.port

async function startServer() {
  let connection

  try {
    connection = await pool.getConnection()
    console.log('MySQL connected successfully')

    app.listen(port, () => {
      console.log(`Server running on port ${port}`)
    })
  } catch (error) {
    console.error('Unable to connect to MySQL:', error.message)
    process.exitCode = 1
  } finally {
    connection?.release()
  }
}

startServer()
