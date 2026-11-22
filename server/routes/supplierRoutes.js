import { Router } from 'express'
import {
  archiveSupplier,
  createSupplier,
  getArchivedSuppliers,
  getSuppliers,
  restoreSupplier,
  updateSupplier,
} from '../controllers/supplierController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles, { authorizeCapability } from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, authorizeCapability('supplier.read'), getSuppliers)
router.get('/archived', authenticate, authorizeRoles('Admin'), getArchivedSuppliers)
router.post('/', authenticate, authorizeRoles('Admin'), createSupplier)
router.patch('/:id', authenticate, authorizeRoles('Admin'), updateSupplier)
router.patch('/:id/archive', authenticate, authorizeRoles('Admin'), archiveSupplier)
router.patch('/:id/restore', authenticate, authorizeRoles('Admin'), restoreSupplier)

export default router
