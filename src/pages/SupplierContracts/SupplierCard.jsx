import { peso } from '../../utils/currency.js'

function SupplierCard({ supplier, records }) {
  const totalSpend = records.reduce((sum, record) => sum + Number(record.total_cost), 0)

  return (
    <article className="supplier-card">
      <div className="supplier-card-heading">
        <span>SUP-{supplier.supplier_id}</span>
        <h3>{supplier.supplier_name}</h3>
      </div>
      <dl className="supplier-contact-list">
        <div><dt>Contact person</dt><dd>{supplier.contact_person || 'Not provided'}</dd></div>
        <div><dt>Contact number</dt><dd>{supplier.contact_number || 'Not provided'}</dd></div>
        <div><dt>Address</dt><dd>{supplier.address || 'Not provided'}</dd></div>
      </dl>
      <div className="supplier-card-summary">
        <div><span>Confirmed deliveries</span><strong>{records.length.toLocaleString('en-PH')}</strong></div>
        <div><span>Total recorded cost</span><strong>{peso.format(totalSpend)}</strong></div>
      </div>
    </article>
  )
}

export default SupplierCard
