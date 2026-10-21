import { Router } from 'express'
import authenticate from '../middleware/authenticate.js'
import {
  createCustomer,
  getCustomer,
  getCustomerCredits,
  getCustomerPayments,
  getCustomers,
  updateCustomer,
} from '../controllers/customerController.js'

const router = Router()
router.use(authenticate)
router.get('/', getCustomers)
router.post('/', createCustomer)
router.get('/:id/credits', getCustomerCredits)
router.get('/:id/payments', getCustomerPayments)
router.patch('/:id', updateCustomer)
router.get('/:id', getCustomer)
export default router
