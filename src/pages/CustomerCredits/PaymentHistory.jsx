import { peso } from '../../utils/currency.js'

function PaymentHistory() {
  return (
    <div className="history-grid">
      <div>
        <h3>Credit Sales History</h3>
        <p>OR-1029 - {peso.format(10450)}</p>
        <p>OR-1014 - {peso.format(3800)}</p>
      </div>
      <div>
        <h3>Payment History</h3>
        <p>May 21 - {peso.format(8000)}</p>
        <p>May 18 - {peso.format(1200)}</p>
      </div>
    </div>
  )
}

export default PaymentHistory
