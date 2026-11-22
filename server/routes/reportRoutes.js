import { Router } from 'express'
import authenticate from '../middleware/authenticate.js'
import authorizeRoles from '../middleware/authorizeRoles.js'
import {
  getInventoryReport,
  getProductSalesReport,
  getReceivablesReport,
  getSalesReport,
  getSalesReportDetail,
  logReportGeneration,
} from '../controllers/reportController.js'

const router = Router()
router.use(authenticate)
router.get('/sales', authorizeRoles('Admin'), getSalesReport)
router.get('/sales/:id', authorizeRoles('Admin'), getSalesReportDetail)
router.get('/product-sales', authorizeRoles('Admin'), getProductSalesReport)
router.get('/inventory', authorizeRoles('Admin'), getInventoryReport)
router.get('/receivables', authorizeRoles('Admin'), getReceivablesReport)
router.post('/log', authorizeRoles('Admin'), logReportGeneration)
export default router
