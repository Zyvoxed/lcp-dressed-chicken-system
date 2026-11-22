import { Router } from 'express'
import { getBusinessAnalytics, getDashboard, getStaffSalesActivity } from '../controllers/dashboardController.js'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles, { authorizeCapability } from '../middleware/authorizeRoles.js'

const router = Router()
router.get('/', authenticate, authorizeCapability('dashboard.read.operational'), getDashboard)
router.get('/sales-activity', authenticate, authorizeRoles('Staff'), getStaffSalesActivity)
router.get('/business', authenticate, authorizeRoles('Admin'), getBusinessAnalytics)
export default router
