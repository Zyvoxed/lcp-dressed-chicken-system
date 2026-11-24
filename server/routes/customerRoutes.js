import { Router } from 'express'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles, { authorizeCapability } from '../middleware/authorizeRoles.js'
import {
  archiveCustomer,
  createCustomer,
  getArchivedCustomers,
  getCustomer,
  getCustomerCashSales,
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
router.get('/', authorizeCapability('customer.read'), getCustomers)
router.post('/', authorizeCapability('customer.create.pos'), createCustomer)
router.get('/:id/credits', authorizeCapability('customer.balance.read'), getCustomerCredits)
router.get('/:id/payments', authorizeCapability('customer.payment.read'), getCustomerPayments)
router.get('/:id/cash-sales', authorizeCapability('customer.payment.read'), getCustomerCashSales)
router.get('/:id/sales', authorizeRoles('Admin'), getCustomerSales)
router.patch('/:id', authorizeRoles('Admin'), updateCustomer)
router.get('/:id', authorizeCapability('customer.balance.read'), getCustomer)
export default router
