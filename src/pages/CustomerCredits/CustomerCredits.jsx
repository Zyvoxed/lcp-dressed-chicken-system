import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import EmptyState from '../Shared/EmptyState.jsx'
import CreditStats from './CreditStats.jsx'
import CustomerLedger from './CustomerLedger.jsx'
import CustomerList, { ArchivedCustomerPanel } from './CustomerList.jsx'
import CustomerModal from '../RecordSales/CustomerModal.jsx'
import { useAuth } from '../../hooks/useAuth.js'
import { useToast } from '../../context/ToastContext.jsx'
import {
  archiveCustomer,
  getCustomer,
  getArchivedCustomers,
  getCustomerCredits,
  getCustomerPayments,
  getCustomerSales,
  getCustomers,
  restoreCustomer,
} from '../../services/customerService.js'

function CustomerCredits() {
  const [customers, setCustomers] = useState([])
  const [archivedCustomers, setArchivedCustomers] = useState([])
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [credits, setCredits] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [sales, setSales] = useState([])
  const [salesLoading, setSalesLoading] = useState(false)
  const [salesError, setSalesError] = useState('')
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [showArchivedPanel, setShowArchivedPanel] = useState(false)
  const [archivedCustomersLoading, setArchivedCustomersLoading] = useState(false)
  const [archivedCustomersError, setArchivedCustomersError] = useState('')
  const { showSuccess, showError, showWarning } = useToast()
  const selectedCustomerIdRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    async function loadCustomers() {
      try {
        const [data, archivedData] = await Promise.all([
          getCustomers({ signal: controller.signal }),
          getArchivedCustomers({ signal: controller.signal }),
        ])
        setCustomers(data)
        setArchivedCustomers(archivedData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadCustomers()
    return () => controller.abort()
  }, [isAdmin])

  useEffect(() => {
    if (!showArchivedPanel) return undefined
    const controller = new AbortController()
    async function loadArchivedCustomers() {
      setArchivedCustomersLoading(true)
      setArchivedCustomersError('')
      try {
        setArchivedCustomers(await getArchivedCustomers({ signal: controller.signal }))
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setArchivedCustomersError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setArchivedCustomersLoading(false)
      }
    }
    loadArchivedCustomers()
    return () => controller.abort()
  }, [showArchivedPanel])

  useEffect(() => {
    if (!selectedCustomer) return undefined
    const controller = new AbortController()
    async function loadDetails() {
      try {
        const [creditData, paymentData] = await Promise.all([
          getCustomerCredits(selectedCustomer.customer_id, { signal: controller.signal }),
          getCustomerPayments(selectedCustomer.customer_id, { signal: controller.signal }),
        ])
        setDetailsError('')
        setCredits(creditData)
        setPayments(paymentData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setDetailsError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setDetailsLoading(false)
      }
    }
    async function loadSales() {
      try {
        setSalesLoading(true)
        const salesData = await getCustomerSales(selectedCustomer.customer_id, { signal: controller.signal })
        setSales(salesData)
        setSalesError('')
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setSalesError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setSalesLoading(false)
      }
    }
    loadDetails()
    loadSales()
    return () => controller.abort()
  }, [selectedCustomer])

  function selectCustomer(customer) {
    if (Number(customer.customer_id) !== Number(selectedCustomer?.customer_id)) {
      setDetailsLoading(true)
      setSalesLoading(true)
      setDetailsError('')
      setSalesError('')
      setCredits([])
      setPayments([])
      setSales([])
    }
    setSelectedCustomer(customer)
    selectedCustomerIdRef.current = customer.customer_id
  }

  const refreshCustomer = useCallback(async (customerId, paymentId) => {
    const [customer, customerList, creditData, paymentData, salesData] = await Promise.all([
      getCustomer(customerId),
      getCustomers(),
      getCustomerCredits(customerId),
      getCustomerPayments(customerId),
      getCustomerSales(customerId),
    ])
    setCustomers(customerList)
    if (Number(selectedCustomerIdRef.current) === Number(customerId)) {
      setSelectedCustomer(customer)
      setCredits(creditData)
      setPayments(paymentData)
      setSales(salesData)
    }
    return paymentData.find((payment) => payment.payment_id === paymentId)
  }, [])

  const refreshLists = useCallback(async () => {
    const [active, archived] = await Promise.all([
      getCustomers(),
      getArchivedCustomers(),
    ])
    setCustomers(active)
    setArchivedCustomers(archived)
  }, [])

  const closeCustomerDrawer = useCallback(() => {
    setSelectedCustomer(null)
    selectedCustomerIdRef.current = null
  }, [])

  const archiveSelectedCustomer = useCallback(async (customer) => {
    try {
      await archiveCustomer(customer.customer_id)
      showSuccess(`${customer.customer_name} was archived. Historical sales and payments were preserved.`)
      try { await refreshLists() } catch (refreshError) { showWarning(`Customer was archived, but the lists could not be refreshed: ${refreshError.message}`) }
      closeCustomerDrawer()
    } catch (error) {
      showError(error.message || 'Unable to archive customer')
      throw error
    }
  }, [closeCustomerDrawer, refreshLists, showError, showSuccess, showWarning])

  const restoreSelectedCustomer = useCallback(async (customer) => {
    try {
      await restoreCustomer(customer.customer_id)
      showSuccess(`${customer.customer_name} was restored and is available for new transactions.`)
      try { await refreshLists() } catch (refreshError) { showWarning(`Customer was restored, but the lists could not be refreshed: ${refreshError.message}`) }
      closeCustomerDrawer()
      setShowArchivedPanel(false)
    } catch (error) {
      showError(error.message || 'Unable to restore customer')
      throw error
    }
  }, [closeCustomerDrawer, refreshLists, showError, showSuccess, showWarning])

  async function selectCustomerById(customerId) {
    const listedCustomer = customers.find((customer) => Number(customer.customer_id) === Number(customerId))
    const customer = listedCustomer || await getCustomer(customerId)
    selectCustomer(customer)
  }

  async function customerCreated(customerId) {
    const customerList = await getCustomers()
    const customer = customerList.find((item) => item.customer_id === customerId)
    setCustomers(customerList)
    if (customer) selectCustomer(customer)
  }

  function closeCustomerModal() {
    setCustomerModalOpen(false)
  }

  return (
    <section className="credits-page page-stack">
      <div className="credits-layout">
      {loading
        ? <PageSkeleton variant="customer-credit-stats" label="customer credit summary" />
        : <CreditStats customers={customers} archivedCustomers={archivedCustomers} />}
      {loading && <PageSkeleton variant="customer-credits" label="customer credit records" />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && (
        <CustomerList
          customers={customers}
          onSelect={selectCustomer}
          onAddCustomer={() => setCustomerModalOpen(true)}
          onShowArchived={() => setShowArchivedPanel(true)}
          isAdmin={isAdmin}
        />
      )}
      {!loading && !error && (
        <AnimatePresence>
          {selectedCustomer && (
            <CustomerLedger
              key={selectedCustomer.customer_id}
              customer={selectedCustomer}
              credits={credits}
              payments={payments}
              sales={sales}
              onPayment={refreshCustomer}
              onArchive={archiveSelectedCustomer}
              onRestore={restoreSelectedCustomer}
              isAdmin={isAdmin}
              onSelectCustomer={selectCustomerById}
              onClose={closeCustomerDrawer}
              loading={detailsLoading}
              error={detailsError}
              salesLoading={salesLoading}
              salesError={salesError}
            />
          )}
        </AnimatePresence>
      )}
      {customerModalOpen && (
        <CustomerModal
          key="add-customer"
          onClose={closeCustomerModal}
          onCreated={customerCreated}
        />
      )}
      {showArchivedPanel && (
        <ArchivedCustomerPanel
          customers={archivedCustomers}
          loading={archivedCustomersLoading}
          error={archivedCustomersError}
          onClose={() => setShowArchivedPanel(false)}
          onRestore={restoreSelectedCustomer}
        />
      )}
      </div>
    </section>
  )
}

export default CustomerCredits
import PageSkeleton from '../Shared/PageSkeleton.jsx'
