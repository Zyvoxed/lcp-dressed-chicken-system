import CreditStats from './CreditStats.jsx'
import CustomerLedger from './CustomerLedger.jsx'
import CustomerList from './CustomerList.jsx'

function CustomerCredits() {
  return (
    <section className="credits-layout">
      <CreditStats />
      <CustomerList />
      <CustomerLedger />
    </section>
  )
}

export default CustomerCredits
