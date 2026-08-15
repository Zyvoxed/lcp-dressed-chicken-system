import { shipmentHistory } from '../../data/suppliers.js'

function SupplierLedger() {
  return (
    <article className="panel">
      <h2>Historical Procurement Ledger</h2>
      {shipmentHistory.map((item) => (
        <div className="shipment-row" key={item}>
          <strong>{item}</strong>
          <p>Shipment cleared and added to stock records.</p>
        </div>
      ))}
    </article>
  )
}

export default SupplierLedger
