function PaymentForm() {
  return (
    <>
      <label>
        Payment posting
        <input type="number" placeholder="Payment amount" />
      </label>
      <button className="primary-action" type="button">
        Post Payment
      </button>
    </>
  )
}

export default PaymentForm
