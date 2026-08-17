import { Router } from 'express'
import { getActivityLogs } from '../controllers/activityLogController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()
router.get('/', authenticate, authorizeRoles('Admin'), getActivityLogs)
export default router
