export const modules = [
  { label: 'Main Dashboard', path: '/dashboard', capability: 'dashboard.read.operational' },
  { label: 'Record Sales', path: '/record-sales', capability: 'pos.sale.create' },
  { label: 'Inventory & Stock In', path: '/inventory', capability: 'inventory.read' },
  { label: 'Customer Credits Book', path: '/customer-credits', capability: 'customer.balance.read' },
  { label: 'Supplier Contracts', path: '/supplier-contracts', capability: 'supplier.read' },
  { label: 'Business Analytics', path: '/business-analytics', adminOnly: true },
  { label: 'Reports & Audits', path: '/reports', capability: 'report.operational.read' },
  { label: 'User Accounts', path: '/user-accounts', adminOnly: true },
  { label: 'Activity Logs', path: '/activity-logs', adminOnly: true },
]

export const defaultRoute = '/dashboard'
export const employeeRoute = '/dashboard'
export const loginRoute = '/login'
export const verifyEmailRoute = '/verify-email'
export const forgotPasswordRoute = '/forgot-password'
export const resetPasswordRoute = '/reset-password'

export const inventoryTabs = ['Product List', 'Stock In Product (Delivery)', 'Inflow Records']

export const reportTabs = [
  'Sales & Revenue Audit',
  'Inventory Assets Valuation',
  'Credit Receivables Ledger',
]

export const staffReportTabs = [
  'Sales Activity Audit',
  'Inventory Status',
  'Customer Receivables Ledger',
]

export const productCategories = [
  'All',
  'Whole Chicken',
  'Prime Cuts',
  'Wings & Drumsticks',
  'Innards & Offal',
]
