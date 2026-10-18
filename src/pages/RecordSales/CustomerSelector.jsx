function CustomerSelector({ customers, paymentType, value, onChange, disabled = false }) {
  return (
    <select value={value} onChange={onChange} disabled={disabled || paymentType === 'Cash'}>
      <option value="">{paymentType === 'Cash' ? 'Walk-In Customer' : 'Select credit customer'}</option>
      {paymentType === 'Credit' && customers.map((customer) => (
        <option key={customer.customer_id} value={customer.customer_id}>{customer.customer_name}</option>
      ))}
    </select>
  )
}

export default CustomerSelector
