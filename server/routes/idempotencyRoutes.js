import { Router } from 'express'
import { getIdempotencyStatus } from '../controllers/idempotencyController.js'
import authenticate from '../middleware/authenticate.js'

const router = Router()

router.get('/:operation/:key', authenticate, getIdempotencyStatus)

export default router
