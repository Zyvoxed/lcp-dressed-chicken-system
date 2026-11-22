import { Router } from 'express'
import { createSale, getSales } from '../controllers/salesController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, authorizeRoles('Admin'), getSales)
router.post('/', authenticate, authorizeRoles('Admin', 'Staff'), createSale)

export default router
