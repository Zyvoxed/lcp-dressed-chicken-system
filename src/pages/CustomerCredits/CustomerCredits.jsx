import { useEffect, useState } from 'react'
import EmptyState from '../Shared/EmptyState.jsx'
import LoadingSpinner from '../Shared/LoadingSpinner.jsx'
import CreditStats from './CreditStats.jsx'
import CustomerLedger from './CustomerLedger.jsx'
import CustomerList from './CustomerList.jsx'
import { getCustomer, getCustomerCredits, getCustomerPayments, getCustomers } from '../../services/customerService.js'

function CustomerCredits() {
  const [customers, setCustomers] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [credits, setCredits] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function loadCustomers() {
      try {
        const data = await getCustomers({ signal: controller.signal })
        setCustomers(data)
        setSelectedCustomer(data[0] || null)
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
        setCredits(creditData)
        setPayments(paymentData)
      } catch (requestError) {
        if (requestError.name !== 'AbortError') setError(requestError.message)
      }
    }
    loadDetails()
    return () => controller.abort()
  }, [selectedCustomer])

  async function refreshCustomer() {
    const [customer, customerList, creditData, paymentData] = await Promise.all([
      getCustomer(selectedCustomer.customer_id), getCustomers(),
      getCustomerCredits(selectedCustomer.customer_id), getCustomerPayments(selectedCustomer.customer_id),
    ])
    setSelectedCustomer(customer)
    setCustomers(customerList)
    setCredits(creditData)
    setPayments(paymentData)
  }

  return (
    <section className="credits-layout">
      <CreditStats customers={customers} />
      {loading && <LoadingSpinner />}
      {!loading && error && <EmptyState>{error}</EmptyState>}
      {!loading && !error && <CustomerList customers={customers} selectedCustomer={selectedCustomer} onSelect={setSelectedCustomer} />}
      {!loading && !error && <CustomerLedger customer={selectedCustomer} credits={credits} payments={payments} onPayment={refreshCustomer} />}
    </section>
  )
}

export default CustomerCredits
