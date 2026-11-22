import { Router } from 'express'
import { createSale, getSales } from '../controllers/salesController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles, { authorizeCapability } from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, authorizeRoles('Admin'), getSales)
router.post('/', authenticate, authorizeCapability('pos.sale.create'), createSale)

export default router
