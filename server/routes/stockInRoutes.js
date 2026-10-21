import { Router } from 'express'
import { createStockIn, getStockInBatchAllocations, getStockInRecords } from '../controllers/stockInController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.get('/', authenticate, getStockInRecords)
router.get('/:id/allocations', authenticate, getStockInBatchAllocations)
router.post('/', authenticate, createStockIn)

export default router
