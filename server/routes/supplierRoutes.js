import { Router } from 'express'
import {
  archiveSupplier,
  createSupplier,
  getArchivedSuppliers,
  getSuppliers,
  restoreSupplier,
} from '../controllers/supplierController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, getSuppliers)
router.get('/archived', authenticate, getArchivedSuppliers)
router.post('/', authenticate, authorizeRoles('Admin'), createSupplier)
router.patch('/:id/archive', authenticate, authorizeRoles('Admin'), archiveSupplier)
router.patch('/:id/restore', authenticate, authorizeRoles('Admin'), restoreSupplier)

export default router
