import { useEffect, useRef, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import CreditStats from './CreditStats.jsx'
import CustomerLedger from './CustomerLedger.jsx'
import CustomerList from './CustomerList.jsx'
import CustomerModal from '../RecordSales/CustomerModal.jsx'
import { getCustomer, getCustomerCredits, getCustomerPayments, getCustomers } from '../../services/customerService.js'

function CustomerCredits() {
  const [customers, setCustomers] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [credits, setCredits] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const selectedCustomerIdRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()
    async function loadCustomers() {
      try {
        const data = await getCustomers({ signal: controller.signal })
        setCustomers(data)
        setDetailsLoading(Boolean(data[0]))
        setSelectedCustomer(data[0] || null)
        selectedCustomerIdRef.current = data[0]?.customer_id || null
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadCustomers()
    return () => controller.abort()
  }, [])

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
    loadDetails()
    return () => controller.abort()
  }, [selectedCustomer])

  function selectCustomer(customer) {
    if (customer.customer_id === selectedCustomer?.customer_id) return
    setDetailsLoading(true)
    setDetailsError('')
    setCredits([])
    setPayments([])
    setSelectedCustomer(customer)
    selectedCustomerIdRef.current = customer.customer_id
  }

  async function refreshCustomer(customerId, paymentId) {
    const [customer, customerList, creditData, paymentData] = await Promise.all([
      getCustomer(customerId), getCustomers(),
      getCustomerCredits(customerId), getCustomerPayments(customerId),
    ])
    setCustomers(customerList)
    if (Number(selectedCustomerIdRef.current) === Number(customerId)) {
      setSelectedCustomer(customer)
      setCredits(creditData)
      setPayments(paymentData)
    }
    return paymentData.find((payment) => payment.payment_id === paymentId)
  }

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

  async function customerUpdated(updatedCustomer) {
    const [customerList, customer] = await Promise.all([
      getCustomers(),
      getCustomer(updatedCustomer.customer_id),
    ])
    setCustomers(customerList)
    setSelectedCustomer(customer)
    selectedCustomerIdRef.current = customer.customer_id
  }

  function closeCustomerModal() {
    setCustomerModalOpen(false)
    setEditingCustomer(null)
  }

  return (
    <section className="credits-page page-stack">
      <div className="credits-layout">
      {loading
        ? <PageSkeleton variant="customer-credit-stats" label="customer credit summary" />
        : <CreditStats customers={customers} />}
      {loading && <PageSkeleton variant="customer-credits" label="customer credit records" />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && (
        <CustomerList
          customers={customers}
          selectedCustomer={selectedCustomer}
          onSelect={selectCustomer}
          onAddCustomer={() => { setEditingCustomer(null); setCustomerModalOpen(true) }}
        />
      )}
      {!loading && !error && <CustomerLedger customer={selectedCustomer} credits={credits} payments={payments} onPayment={refreshCustomer} onSelectCustomer={selectCustomerById} onEdit={(customer) => { setEditingCustomer(customer); setCustomerModalOpen(true) }} loading={detailsLoading} error={detailsError} />}
      {customerModalOpen && (
        <CustomerModal
          key={editingCustomer ? `edit-${editingCustomer.customer_id}` : 'add-customer'}
          customer={editingCustomer}
          onClose={closeCustomerModal}
          onCreated={customerCreated}
          onUpdated={customerUpdated}
        />
      )}
      </div>
    </section>
  )
}

export default CustomerCredits
import PageSkeleton from '../Shared/PageSkeleton.jsx'
