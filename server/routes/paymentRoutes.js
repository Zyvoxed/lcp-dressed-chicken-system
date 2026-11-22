import { Router } from 'express'
import { recordPayment } from '../controllers/paymentController.js'
import authenticate from '../middleware/authenticate.js'
import { authorizeCapability } from '../middleware/authorizeRoles.js'

const router = Router()
router.post('/', authenticate, authorizeCapability('customer.payment.create'), recordPayment)
export default router
