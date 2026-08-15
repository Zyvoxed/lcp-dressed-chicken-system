import BusinessAnalytics from './BusinessAnalytics.jsx'
import DashboardStats from './DashboardStats.jsx'
import RestockChecklist from './RestockChecklist.jsx'
import SalesChart from './SalesChart.jsx'
import SalesLedgerTable from './SalesLedgerTable.jsx'
import { useAuth } from '../../hooks/useAuth.js'

function Dashboard() {
  const { role } = useAuth()

  return (
    <section className="page-stack">
      <DashboardStats role={role} />
      <div className="dashboard-grid">
        <SalesChart />
        <RestockChecklist />
      </div>
      <BusinessAnalytics />
      <SalesLedgerTable />
    </section>
  )
}

export default Dashboard
