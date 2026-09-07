import { Router } from 'express'
import { createSupplier, getSuppliers } from '../controllers/supplierController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, getSuppliers)
router.post('/', authenticate, authorizeRoles('Admin'), createSupplier)

export default router
