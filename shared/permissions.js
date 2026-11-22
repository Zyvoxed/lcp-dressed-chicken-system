export const staffCapabilities = Object.freeze([
  'dashboard.read.operational',
  'pos.sale.create',
  'inventory.read',
  'stockin.read',
  'stockin.create',
  'supplier.read',
  'customer.read',
  'customer.create.pos',
  'customer.balance.read',
  'customer.payment.create',
  'customer.payment.read',
  'report.operational.read',
  'report.operational.export',
])

export function normalizeRole(role) {
  if (role === 'Admin' || role === 'admin') return 'admin'
  if (role === 'Staff' || role === 'employee' || role === 'staff') return 'employee'
  return null
}

export function hasCapability(role, capability) {
  const normalized = normalizeRole(role)
  if (normalized === 'admin') return true
  return normalized === 'employee' && staffCapabilities.includes(capability)
}
