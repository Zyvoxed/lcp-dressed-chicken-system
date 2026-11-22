import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AuthProvider } from '../context/AuthContext.jsx'
import ProtectedLayout from '../layouts/ProtectedLayout.jsx'
import Dashboard from '../pages/Dashboard/Dashboard.jsx'
import RecordSales from '../pages/RecordSales/RecordSales.jsx'
import Inventory from '../pages/Inventory/Inventory.jsx'
import CustomerCredits from '../pages/CustomerCredits/CustomerCredits.jsx'
import SupplierContracts from '../pages/SupplierContracts/SupplierContracts.jsx'
import Reports from '../pages/Reports/Reports.jsx'
import BusinessAnalytics from '../pages/Dashboard/BusinessAnalytics.jsx'
import ActivityLogs from '../pages/ActivityLogs/ActivityLogs.jsx'
import PageTransition from '../pages/Shared/PageTransition.jsx'
import UserAccounts from '../pages/UserAccounts/UserAccounts.jsx'
import VerifyEmail from '../pages/Login/VerifyEmail.jsx'
import ForgotPassword from '../pages/Login/ForgotPassword.jsx'
import ResetPassword from '../pages/Login/ResetPassword.jsx'
import { forgotPasswordRoute, modules, resetPasswordRoute, verifyEmailRoute } from '../utils/constants.js'
import { normalizeRole } from '../utils/rolePermissions.js'
import { useAuth } from '../hooks/useAuth.js'
import StaffDashboard from '../pages/Staff/StaffDashboard.jsx'
import StaffSuppliers from '../pages/Staff/StaffSuppliers.jsx'
import StaffReports from '../pages/Staff/StaffReports.jsx'

function ModulePage({ activeModule }) {
  const { role } = useAuth()
  const normalizedRole = normalizeRole(role)
  if (normalizedRole === 'employee') {
    if (activeModule === 'Main Dashboard') return <StaffDashboard />
    if (activeModule === 'Record Sales') return <RecordSales />
    if (activeModule === 'Inventory & Stock In') return <Inventory />
    if (activeModule === 'Customer Credits Book') return <CustomerCredits />
    if (activeModule === 'Supplier Contracts') return <StaffSuppliers />
    if (activeModule === 'Reports & Audits') return <StaffReports />
    // Do not render an Admin component during the redirect frame for a restricted URL.
    return <StaffDashboard />
  }
  if (normalizedRole !== 'admin') return null

  const page = {
    'Main Dashboard': <Dashboard />,
    'Record Sales': <RecordSales />,
    'Inventory & Stock In': <Inventory />,
    'Customer Credits Book': <CustomerCredits />,
    'Supplier Contracts': <SupplierContracts />,
    'Business Analytics': <BusinessAnalytics />,
    'Reports & Audits': <Reports />,
    'Activity Logs': <ActivityLogs />,
    'User Accounts': <UserAccounts />,
  }[activeModule]
  return page || null
}

function AppRoutes() {
  const moduleForPath = () => {
    const currentPath = window.location.pathname === '/stock-in' ? '/inventory' : window.location.pathname
    return modules.find((module) => module.path === currentPath) || modules[0]
  }
  const [activeModule, setActiveModule] = useState(() => moduleForPath().label)
  const [routePath, setRoutePath] = useState(() => window.location.pathname)

  function selectModule(label) {
    const selected = modules.find((module) => module.label === label) || modules[0]
    window.history.pushState({}, '', selected.path)
    setActiveModule(selected.label)
    setRoutePath(selected.path)
  }

  useEffect(() => {
    const handleNavigation = () => {
      setActiveModule(moduleForPath().label)
      setRoutePath(window.location.pathname)
    }
    window.addEventListener('popstate', handleNavigation)
    return () => window.removeEventListener('popstate', handleNavigation)
  }, [])

  if (routePath === verifyEmailRoute) {
    return (
      <AnimatePresence mode="wait">
        <PageTransition key={routePath}><VerifyEmail /></PageTransition>
      </AnimatePresence>
    )
  }

  if (routePath === forgotPasswordRoute) {
    return (
      <AnimatePresence mode="wait">
        <PageTransition key={routePath}><ForgotPassword /></PageTransition>
      </AnimatePresence>
    )
  }

  if (routePath === resetPasswordRoute) {
    return (
      <AnimatePresence mode="wait">
        <PageTransition key={routePath}><ResetPassword /></PageTransition>
      </AnimatePresence>
    )
  }

  return (
    <AuthProvider>
      <ProtectedLayout activeModule={activeModule} onSelect={selectModule}>
        <AnimatePresence mode="wait">
          <PageTransition key={activeModule}><ModulePage activeModule={activeModule} /></PageTransition>
        </AnimatePresence>
      </ProtectedLayout>
    </AuthProvider>
  )
}

export default AppRoutes
