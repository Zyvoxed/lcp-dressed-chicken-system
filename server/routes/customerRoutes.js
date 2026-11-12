import { Router } from 'express'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'
import {
  archiveCustomer,
  createCustomer,
  getArchivedCustomers,
  getCustomer,
  getCustomerCredits,
  getCustomerPayments,
  getCustomerSales,
  getCustomers,
  restoreCustomer,
  updateCustomer,
} from '../controllers/customerController.js'

const router = Router()
router.use(authenticate)
router.get('/archived', getArchivedCustomers)
router.patch('/:id/archive', authorizeRoles('Admin'), archiveCustomer)
router.patch('/:id/restore', authorizeRoles('Admin'), restoreCustomer)
router.get('/', getCustomers)
router.post('/', createCustomer)
router.get('/:id/credits', getCustomerCredits)
router.get('/:id/payments', getCustomerPayments)
router.get('/:id/sales', getCustomerSales)
router.patch('/:id', updateCustomer)
router.get('/:id', getCustomer)
export default router
