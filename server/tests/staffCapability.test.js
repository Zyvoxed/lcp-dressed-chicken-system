import assert from 'node:assert/strict'
import test from 'node:test'
import { staffCapabilities, hasCapability, normalizeRole } from '../../shared/permissions.js'
import { modules } from '../../src/utils/constants.js'
import { hasRouteAccess } from '../../src/utils/rolePermissions.js'

test('backend and frontend share the explicit Staff capability allowlist', () => {
  const expected = [
    'dashboard.read.operational', 'pos.sale.create', 'inventory.read',
    'stockin.read', 'stockin.create', 'supplier.read', 'customer.read',
    'customer.create.pos', 'customer.balance.read', 'customer.payment.create',
    'customer.payment.read', 'report.operational.read', 'report.operational.export',
  ]
  assert.deepEqual(staffCapabilities, expected)
  for (const capability of expected) assert.equal(hasCapability('Staff', capability), true)
  assert.equal(hasCapability('Staff', 'analytics.business.read'), false)
  assert.equal(hasCapability('Staff', 'user.manage'), false)
  assert.equal(hasCapability('Staff', 'activity.read'), false)
  assert.equal(hasCapability('Admin', 'analytics.business.read'), true)
})

test('role normalization accepts established backend and frontend names safely', () => {
  assert.equal(normalizeRole('Admin'), 'admin')
  assert.equal(normalizeRole('admin'), 'admin')
  assert.equal(normalizeRole('Staff'), 'employee')
  assert.equal(normalizeRole('employee'), 'employee')
  assert.equal(normalizeRole('unknown'), null)
})

test('Staff can navigate the six approved modules but not Admin-only modules', () => {
  const accessible = modules.filter((module) => hasRouteAccess(module, 'employee')).map((module) => module.path)
  assert.deepEqual(accessible, ['/dashboard', '/record-sales', '/inventory', '/customer-credits', '/supplier-contracts', '/reports'])
  for (const module of modules.filter((item) => item.adminOnly)) assert.equal(hasRouteAccess(module, 'employee'), false)
})
