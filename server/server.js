import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import pool from './config/database.js'
import authRoutes from './routes/authRoutes.js'
import customerRoutes from './routes/customerRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import productRoutes from './routes/productRoutes.js'
import salesRoutes from './routes/salesRoutes.js'
import stockInRoutes from './routes/stockInRoutes.js'
import supplierRoutes from './routes/supplierRoutes.js'

const app = express()
const port = process.env.PORT || 5000

app.use(cors())
app.use(express.json())
app.use('/api/auth', authRoutes)
app.use('/api/customers', customerRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/products', productRoutes)
app.use('/api/sales', salesRoutes)
app.use('/api/stock-in', stockInRoutes)
app.use('/api/suppliers', supplierRoutes)

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
