import { Router } from 'express'
import { getBusinessAnalytics, getDashboard } from '../controllers/dashboardController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'

const router = Router()
router.get('/', authenticate, getDashboard)
router.get('/business', authenticate, authorizeRoles('Admin'), getBusinessAnalytics)
export default router
