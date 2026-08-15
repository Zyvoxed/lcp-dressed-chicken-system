import { peso } from '../../utils/currency.js'

function SupplierCard({ supplier, selected }) {
  const [name, contact, phone, address, deliveries, volume, spend] = supplier

  return (
    <article className={`supplier-card ${selected ? 'selected' : ''}`}>
      <h2>{name}</h2>
      <p>Contact Person: {contact}</p>
      <p>Phone Number: {phone}</p>
      <p>Address: {address}</p>
      <div>
        <span>Deliveries: {deliveries}</span>
        <span>Volume: {volume}</span>
        <strong>Total Spend: {peso.format(spend)}</strong>
      </div>
    </article>
  )
}

export default SupplierCard
