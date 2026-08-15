import { Router } from 'express'
import { createSale, getSales } from '../controllers/salesController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.get('/', authenticate, getSales)
router.post('/', authenticate, createSale)

export default router
