function SupplierCard({ supplier, selected }) {
  return (
    <article className={`supplier-card ${selected ? 'selected' : ''}`}>
      <h2>{supplier.supplier_name}</h2>
      <p>Contact Person: {supplier.contact_person || '—'}</p>
      <p>Phone Number: {supplier.contact_number || '—'}</p>
      <p>Address: {supplier.address || '—'}</p>
      <div>
        <span>Deliveries: —</span>
        <span>Volume: —</span>
        <strong>Total Spend: —</strong>
      </div>
    </article>
  )
}

export default SupplierCard
