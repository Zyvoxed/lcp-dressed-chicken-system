import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/variables.css'
import './styles/global.css'
import './styles/layouts/MainLayout.css'
import './styles/layouts/Sidebar.css'
import './styles/layouts/Header.css'
import './styles/shared/Cards.css'
import './styles/shared/Tables.css'
import './styles/shared/Forms.css'
import './styles/shared/Shared.css'
import './styles/shared/Modal.css'
import './styles/pages/Login.css'
import './styles/pages/Dashboard.css'
import './styles/pages/RecordSales.css'
import './styles/pages/Inventory.css'
import './styles/pages/CustomerCredits.css'
import './styles/pages/SupplierContracts.css'
import './styles/pages/Reports.css'
import './styles/pages/UserAccounts.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
