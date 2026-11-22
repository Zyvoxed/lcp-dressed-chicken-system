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

function routeCapability(router, method, path) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])?.route
  return route?.stack.map((layer) => layer.handle.capability).find(Boolean) || null
}

function routerRoles(router) {
  return router.stack.map((layer) => layer.handle.allowedRoles).find(Boolean) || []
}

function assertRoles(actual, expected, label) {
  assert.deepEqual([...actual].sort(), [...expected].sort(), label)
}

test('Staff server permissions match the explicit operational capability allowlist', () => {
  assertRoles(routeRoles(salesRoutes, 'get', '/'), ['Admin'], 'Sales monitoring is Admin-only')
  assert.equal(routeCapability(salesRoutes, 'post', '/'), 'pos.sale.create')
  assert.equal(routeCapability(paymentRoutes, 'post', '/'), 'customer.payment.create')
  assert.equal(routeCapability(customerRoutes, 'get', '/'), 'customer.read')
  assert.equal(routeCapability(customerRoutes, 'get', '/:id/credits'), 'customer.balance.read')
  assert.equal(routeCapability(customerRoutes, 'get', '/:id/payments'), 'customer.payment.read')
  assertRoles(routeRoles(customerRoutes, 'get', '/:id/sales'), ['Admin'], 'Customer sales history is Admin-only')
  assert.equal(routeCapability(customerRoutes, 'post', '/'), 'customer.create.pos')
  assert.equal(routeCapability(customerRoutes, 'get', '/:id'), 'customer.balance.read')
  assert.equal(routeCapability(productRoutes, 'get', '/'), 'pos.sale.create')
  assert.equal(routeCapability(productRoutes, 'get', '/inventory'), 'inventory.read')
  assert.equal(routeCapability(stockInRoutes, 'get', '/'), 'stockin.read')
  assert.equal(routeCapability(stockInRoutes, 'post', '/'), 'stockin.create')
  assert.equal(routeCapability(supplierRoutes, 'get', '/'), 'supplier.read')
  assert.equal(routeCapability(dashboardRoutes, 'get', '/'), 'dashboard.read.operational')
  assert.equal(routeCapability(reportRoutes, 'get', '/operational/:report'), 'report.operational.read')
  assert.equal(routeCapability(reportRoutes, 'get', '/operational/:report/export'), 'report.operational.export')
  assertRoles(routeRoles(reportRoutes, 'get', '/sales'), ['Admin'], 'Sales reports are Admin-only')
  assertRoles(routeRoles(reportRoutes, 'get', '/sales/:id'), ['Admin'], 'Sale details are Admin-only')
  assertRoles(routeRoles(reportRoutes, 'get', '/receivables'), ['Admin'], 'Credit reports are Admin-only')
})

test('Admin-only configuration and audit endpoints stay protected', () => {
  assertRoles(routerRoles(userRoutes), ['Admin'], 'All account management is Admin-only')
  assertRoles(routeRoles(activityLogRoutes, 'get', '/'), ['Admin'], 'Activity logs remain Admin-only')
  assertRoles(routeRoles(dashboardRoutes, 'get', '/business'), ['Admin'], 'Business analytics remain Admin-only')
  assertRoles(routeRoles(reportRoutes, 'get', '/inventory'), ['Admin'], 'Inventory valuation remains Admin-only')
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
