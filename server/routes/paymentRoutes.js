import { Router } from 'express'
import { recordPayment } from '../controllers/paymentController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()
router.post('/', authenticate, authorizeRoles('Admin'), recordPayment)
export default router
