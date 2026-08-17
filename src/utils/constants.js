export const modules = [
  { label: 'Main Dashboard', path: '/dashboard', roles: ['admin', 'employee'] },
  { label: 'Record Sales', path: '/record-sales', roles: ['admin', 'employee'] },
  { label: 'Inventory & Stock In', path: '/inventory', roles: ['admin', 'employee'] },
  { label: 'Customer Credits Book', path: '/customer-credits', roles: ['admin', 'employee'] },
  { label: 'Supplier Contracts', path: '/supplier-contracts', roles: ['admin'] },
  { label: 'Business Analytics', path: '/business-analytics', roles: ['admin'] },
  { label: 'Reports & Audits', path: '/reports', roles: ['admin'] },
  { label: 'Activity Logs', path: '/activity-logs', roles: ['admin'] },
  { label: 'User Accounts', path: '/user-accounts', roles: ['admin'] },
]

export const defaultRoute = '/dashboard'
export const loginRoute = '/login'

export const inventoryTabs = ['Product List', 'Stock In Product (Delivery)', 'Inflow Records']

export const reportTabs = [
  'Sales & Revenue Audit',
  'Inventory Assets Valuation',
  'Credit Receivables Ledger',
]

export const productCategories = [
  'All',
  'Whole Chicken',
  'Prime Cuts',
  'Wings & Drumsticks',
  'Innards & Offal',
]
