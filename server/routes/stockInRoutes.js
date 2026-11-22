import { Router } from 'express'
import { createStockIn, getStockInBatchAllocations, getStockInRecords } from '../controllers/stockInController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles, { authorizeCapability } from '../middleware/authorizeRoles.js'

const router = Router()

router.get('/', authenticate, authorizeCapability('stockin.read'), getStockInRecords)
router.get('/:id/allocations', authenticate, authorizeRoles('Admin'), getStockInBatchAllocations)
router.post('/', authenticate, authorizeCapability('stockin.create'), createStockIn)

export default router
