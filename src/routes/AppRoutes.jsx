import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AuthProvider } from '../context/AuthContext.jsx'
import ProtectedLayout from '../layouts/ProtectedLayout.jsx'
import Dashboard from '../pages/Dashboard/Dashboard.jsx'
import RecordSales from '../pages/RecordSales/RecordSales.jsx'
import Inventory from '../pages/Inventory/Inventory.jsx'
import CustomerCredits from '../pages/CustomerCredits/CustomerCredits.jsx'
import SupplierContracts from '../pages/SupplierContracts/SupplierContracts.jsx'
import Reports from '../pages/Reports/Reports.jsx'
import PageTransition from '../pages/Shared/PageTransition.jsx'
import UserAccounts from '../pages/UserAccounts/UserAccounts.jsx'
import { modules } from '../utils/constants.js'

function AppRoutes() {
  const [activeModule, setActiveModule] = useState(modules[0].label)

  const activePage = {
    'Main Dashboard': <Dashboard />,
    'Record Sales': <RecordSales />,
    'Inventory & Stock In': <Inventory />,
    'Customer Credits Book': <CustomerCredits />,
    'Supplier Contracts': <SupplierContracts />,
    'Reports & Audits': <Reports />,
    'User Accounts': <UserAccounts />,
  }[activeModule]

  return (
    <AuthProvider>
      <ProtectedLayout activeModule={activeModule} onSelect={setActiveModule}>
        <AnimatePresence mode="wait">
          <PageTransition key={activeModule}>{activePage}</PageTransition>
        </AnimatePresence>
      </ProtectedLayout>
    </AuthProvider>
  )
}

export default AppRoutes
