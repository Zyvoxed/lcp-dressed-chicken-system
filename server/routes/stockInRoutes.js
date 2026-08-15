import { Router } from 'express'
import { createStockIn, getStockInRecords } from '../controllers/stockInController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.get('/', authenticate, getStockInRecords)
router.post('/', authenticate, createStockIn)

export default router
