import { Router } from 'express'
import {
  archiveProduct,
  createProduct,
  getArchivedProducts,
  getProducts,
  restoreProduct,
  updateProduct,
} from '../controllers/productController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles, { authorizeCapability } from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, authorizeCapability('pos.sale.create'), getProducts)
router.get('/inventory', authenticate, authorizeCapability('inventory.read'), getProducts)
router.get('/archived', authenticate, authorizeRoles('Admin'), getArchivedProducts)
router.post('/', authenticate, authorizeRoles('Admin'), createProduct)
router.patch('/:id/archive', authenticate, authorizeRoles('Admin'), archiveProduct)
router.patch('/:id/restore', authenticate, authorizeRoles('Admin'), restoreProduct)
router.patch('/:id', authenticate, authorizeRoles('Admin'), updateProduct)

export default router
