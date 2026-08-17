import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import pool from './config/database.js'
import activityLogRoutes from './routes/activityLogRoutes.js'
import authRoutes from './routes/authRoutes.js'
import customerRoutes from './routes/customerRoutes.js'
import dashboardRoutes from './routes/dashboardRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import productRoutes from './routes/productRoutes.js'
import reportRoutes from './routes/reportRoutes.js'
import salesRoutes from './routes/salesRoutes.js'
import stockInRoutes from './routes/stockInRoutes.js'
import supplierRoutes from './routes/supplierRoutes.js'
import userRoutes from './routes/userRoutes.js'

const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())
app.use('/api/activity-logs', activityLogRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/analytics/dashboard', dashboardRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/products', productRoutes)
app.use('/api/reports', reportRoutes)
app.use('/api/sales', salesRoutes)
app.use('/api/stock-in', stockInRoutes)
app.use('/api/suppliers', supplierRoutes)
app.use('/api/users', userRoutes)

app.get('/api/health', (request, response) => {
  response.json({
    success: true,
    message: 'LCP API is running',
  })
})

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
