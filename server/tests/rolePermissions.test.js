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
import { getDashboard } from '../controllers/dashboardController.js'
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

test('Staff bookkeeping endpoints are authorized server-side', () => {
  assertRoles(routeRoles(salesRoutes, 'get', '/'), [], 'Authenticated Staff and Admin can read sales')
  assertRoles(routeRoles(salesRoutes, 'post', '/'), [], 'Authenticated Staff and Admin can record sales')
  assertRoles(routeRoles(paymentRoutes, 'post', '/'), [], 'Authenticated Staff and Admin can record payments')
  assertRoles(routeRoles(customerRoutes, 'get', '/'), [], 'Staff can read customers')
  assertRoles(routeRoles(customerRoutes, 'get', '/:id/credits'), [], 'Staff can read customer ledgers')
  assertRoles(routeRoles(customerRoutes, 'post', '/'), [], 'Staff can register customers through existing workflows')
  assertRoles(routeRoles(stockInRoutes, 'get', '/'), [], 'Staff can view stock-in records')
  assertRoles(routeRoles(supplierRoutes, 'get', '/'), [], 'Staff can view active suppliers')
  assertRoles(routeRoles(reportRoutes, 'get', '/sales'), ['Admin', 'Staff'], 'Staff can read sales reports')
  assertRoles(routeRoles(reportRoutes, 'get', '/sales/:id'), ['Admin', 'Staff'], 'Staff can read sale details')
  assertRoles(routeRoles(reportRoutes, 'get', '/receivables'), ['Admin', 'Staff'], 'Staff can read credit reports')
  assertRoles(routeRoles(dashboardRoutes, 'get', '/'), ['Admin', 'Staff'], 'Staff can access the role-scoped dashboard')
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

test('Staff dashboard returns operational bookkeeping summaries without Admin analytics', async () => {
  const originalExecute = pool.execute
  const calls = []
  pool.execute = async (sql) => {
    calls.push(sql)
    return calls.length === 1
      ? [[{ today_sales: '1250.00', today_transactions: 4, outstanding_credits: '300.00', payments_today: '100.00' }]]
      : [[{ transaction_type: 'Sale', reference_id: 13, customer_name: 'Maria Santos', amount: '250.00', status: 'Paid', occurred_at: '2026-11-13T10:30:00+08:00' }]]
  }
  try {
    const response = responseRecorder()
    await getDashboard({ user: { role: 'Staff' } }, response)
    assert.equal(response.statusCode, 200)
    assert.equal(calls.length, 2)
    assert.equal(response.payload.data.summary.today_transactions, 4)
    assert.equal(response.payload.data.recent_transactions[0].reference_id, 13)
    assert.equal(Object.hasOwn(response.payload.data, 'recent_activity'), false)
    assert.equal(Object.hasOwn(response.payload.data, 'top_products'), false)
  } finally { pool.execute = originalExecute }
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
