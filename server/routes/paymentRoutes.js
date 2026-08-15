import { Router } from 'express'
import { recordPayment } from '../controllers/paymentController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()
router.post('/', authenticate, recordPayment)
export default router
