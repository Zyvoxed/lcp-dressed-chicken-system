import cors from 'cors'
import express from 'express'
import { environment } from './config/environment.js'
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

app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === environment.frontendUrl) return callback(null, true)
    if (!environment.production && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      return callback(null, true)
    }
    return callback(null, false)
  },
}))
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

export default app
