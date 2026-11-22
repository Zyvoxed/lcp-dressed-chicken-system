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
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, authorizeRoles('Admin', 'Staff'), getProducts)
router.get('/archived', authenticate, authorizeRoles('Admin'), getArchivedProducts)
router.post('/', authenticate, authorizeRoles('Admin'), createProduct)
router.patch('/:id/archive', authenticate, authorizeRoles('Admin'), archiveProduct)
router.patch('/:id/restore', authenticate, authorizeRoles('Admin'), restoreProduct)
router.patch('/:id', authenticate, authorizeRoles('Admin'), updateProduct)

export default router
