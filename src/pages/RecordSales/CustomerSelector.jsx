function CustomerSelector({ customers, paymentType, value, onChange, disabled = false }) {
  return (
    <select value={value} onChange={onChange} disabled={disabled}>
      <option value="">{paymentType === 'Cash' ? 'Anonymous Walk-in Customer' : 'Select credit customer'}</option>
      {customers.map((customer) => (
        <option key={customer.customer_id} value={customer.customer_id}>{customer.customer_name}</option>
      ))}
    </select>
  )
}

export default CustomerSelector
