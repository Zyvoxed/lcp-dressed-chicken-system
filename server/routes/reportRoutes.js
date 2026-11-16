import { Router } from 'express'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'
import {
  getInventoryReport,
  getReceivablesReport,
  getSalesReport,
  getSalesReportDetail,
  logReportGeneration,
} from '../controllers/reportController.js'

const router = Router()
router.use(authenticate)
router.get('/sales', authorizeRoles('Admin', 'Staff'), getSalesReport)
router.get('/sales/:id', authorizeRoles('Admin', 'Staff'), getSalesReportDetail)
router.get('/inventory', authorizeRoles('Admin'), getInventoryReport)
router.get('/receivables', authorizeRoles('Admin', 'Staff'), getReceivablesReport)
router.post('/log', authorizeRoles('Admin', 'Staff'), logReportGeneration)
export default router
