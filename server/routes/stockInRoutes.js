import { Router } from 'express'
import { createStockIn, getStockInBatchAllocations, getStockInRecords } from '../controllers/stockInController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, authorizeRoles('Admin'), getStockInRecords)
router.get('/:id/allocations', authenticate, authorizeRoles('Admin'), getStockInBatchAllocations)
router.post('/', authenticate, authorizeRoles('Admin'), createStockIn)

export default router
