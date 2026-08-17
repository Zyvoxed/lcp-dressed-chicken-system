import { Router } from 'express'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'
import {
  getInventoryReport,
  getReceivablesReport,
  getSalesReport,
  logReportGeneration,
} from '../controllers/reportController.js'

const router = Router()
router.use(authenticate, authorizeRoles('Admin'))
router.get('/sales', getSalesReport)
router.get('/inventory', getInventoryReport)
router.get('/receivables', getReceivablesReport)
router.post('/log', logReportGeneration)
export default router
