import assert from 'node:assert/strict'
import test from 'node:test'
import activityLogRoutes from '../routes/activityLogRoutes.js'
import customerRoutes from '../routes/customerRoutes.js'
import dashboardRoutes from '../routes/dashboardRoutes.js'
import paymentRoutes from '../routes/paymentRoutes.js'
import pool from '../config/database.js'
import productRoutes from '../routes/productRoutes.js'
import reportRoutes from '../routes/reportRoutes.js'
import salesRoutes from '../routes/salesRoutes.js'
import stockInRoutes from '../routes/stockInRoutes.js'
import supplierRoutes from '../routes/supplierRoutes.js'
import userRoutes from '../routes/userRoutes.js'
import { logReportGeneration } from '../controllers/reportController.js'

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

function routeRoles(router, method, path) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route
  return route?.stack.map((layer) => layer.handle.allowedRoles).find(Boolean) || []
}

function routerRoles(router) {
  return router.stack.map((layer) => layer.handle.allowedRoles).find(Boolean) || []
}

function assertRoles(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label)
}

test('Staff server permissions are limited to POS and its minimum lookup operations', () => {
  assertRoles(routeRoles(salesRoutes, 'get', '/'), ['Admin'], 'Sales monitoring is Admin-only')
  assertRoles(routeRoles(salesRoutes, 'post', '/'), ['Admin', 'Staff'], 'Staff and Admin can check out sales')
  assertRoles(routeRoles(paymentRoutes, 'post', '/'), ['Admin'], 'Customer credit payments are Admin-only')
  assertRoles(routeRoles(customerRoutes, 'get', '/'), ['Admin', 'Staff'], 'POS can look up customers')
  assertRoles(routeRoles(customerRoutes, 'get', '/:id/credits'), ['Admin'], 'Customer credit ledgers are Admin-only')
  assertRoles(routeRoles(customerRoutes, 'get', '/:id/payments'), ['Admin'], 'Customer payment history is Admin-only')
  assertRoles(routeRoles(customerRoutes, 'get', '/:id/sales'), ['Admin'], 'Customer sales history is Admin-only')
  assertRoles(routeRoles(customerRoutes, 'post', '/'), ['Admin', 'Staff'], 'POS can register a customer for checkout')
  assertRoles(routeRoles(customerRoutes, 'get', '/:id'), ['Admin'], 'Customer profiles are Admin-only')
  assertRoles(routeRoles(productRoutes, 'get', '/'), ['Admin', 'Staff'], 'POS can look up sellable products')
  assertRoles(routeRoles(stockInRoutes, 'get', '/'), ['Admin'], 'Stock-in history is Admin-only')
  assertRoles(routeRoles(supplierRoutes, 'get', '/'), ['Admin'], 'Supplier data is Admin-only')
  assertRoles(routeRoles(reportRoutes, 'get', '/sales'), ['Admin'], 'Sales reports are Admin-only')
  assertRoles(routeRoles(reportRoutes, 'get', '/sales/:id'), ['Admin'], 'Sale details are Admin-only')
  assertRoles(routeRoles(reportRoutes, 'get', '/receivables'), ['Admin'], 'Credit reports are Admin-only')
  assertRoles(routeRoles(dashboardRoutes, 'get', '/'), ['Admin'], 'Dashboard analytics are Admin-only')
})

test('Admin-only configuration and audit endpoints stay protected', () => {
  assertRoles(routerRoles(userRoutes), ['Admin'], 'All account management is Admin-only')
  assertRoles(routeRoles(activityLogRoutes, 'get', '/'), ['Admin'], 'Activity logs remain Admin-only')
  assertRoles(routeRoles(dashboardRoutes, 'get', '/business'), ['Admin'], 'Business analytics remain Admin-only')
  assertRoles(routeRoles(reportRoutes, 'get', '/inventory'), ['Admin'], 'Inventory valuation remains Admin-only')
  assertRoles(routeRoles(stockInRoutes, 'post', '/'), ['Admin'], 'Stock-in creation remains Admin-only')
  assertRoles(routeRoles(productRoutes, 'post', '/'), ['Admin'], 'Product configuration remains Admin-only')
  assertRoles(routeRoles(supplierRoutes, 'post', '/'), ['Admin'], 'Supplier management remains Admin-only')
  assertRoles(routeRoles(customerRoutes, 'patch', '/:id/archive'), ['Admin'], 'Customer archiving remains Admin-only')
  assertRoles(routeRoles(customerRoutes, 'patch', '/:id'), ['Admin'], 'Customer profile edits remain Admin-only')
})

test('Staff cannot log administrative inventory valuation reports', async () => {
  const originalExecute = pool.execute
  pool.execute = async () => assert.fail('Administrative report log must be rejected before the database')
  try {
    const response = responseRecorder()
    await logReportGeneration({ user: { role: 'Staff' }, body: { report_type: 'Inventory Valuation' } }, response)
    assert.equal(response.statusCode, 403)
  } finally { pool.execute = originalExecute }
})
