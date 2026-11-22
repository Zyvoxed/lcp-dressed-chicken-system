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
router.get('/archived', authorizeRoles('Admin'), getArchivedCustomers)
router.patch('/:id/archive', authorizeRoles('Admin'), archiveCustomer)
router.patch('/:id/restore', authorizeRoles('Admin'), restoreCustomer)
router.get('/', authorizeRoles('Admin', 'Staff'), getCustomers)
router.post('/', authorizeRoles('Admin', 'Staff'), createCustomer)
router.get('/:id/credits', authorizeRoles('Admin'), getCustomerCredits)
router.get('/:id/payments', authorizeRoles('Admin'), getCustomerPayments)
router.get('/:id/sales', authorizeRoles('Admin'), getCustomerSales)
router.patch('/:id', authorizeRoles('Admin'), updateCustomer)
router.get('/:id', authorizeRoles('Admin'), getCustomer)
export default router
