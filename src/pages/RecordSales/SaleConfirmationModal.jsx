import Modal from '../Shared/Modal.jsx'
import { peso } from '../../utils/currency.js'

function SaleConfirmationModal({ cart, customer, paymentType, total, amountPaid, submitting, error, onCancel, onConfirm }) {
  const remainingBalance = Math.max(total - amountPaid, 0)
  const customerDetails = [
    { label: 'Customer type', value: paymentType === 'Cash' ? 'Walk-in' : 'Credit Supplier' },
    { label: 'Name', value: customer?.customer_name || 'Walk-in Customer' },
    ...(customer?.contact_number ? [{ label: 'Contact number', value: customer.contact_number }] : []),
    ...(customer?.address ? [{ label: 'Address', value: customer.address }] : []),
    ...(paymentType === 'Credit' && customer
      ? [{ label: 'Existing outstanding balance', value: peso.format(Number(customer.current_balance)) }]
      : []),
  ]

  return (
    <Modal title="Confirm Sales Transaction" onClose={onCancel} className="sale-confirmation-modal">
      <p className="confirmation-copy">Review the transaction details before recording this sale.</p>
      <section className="confirmation-section" aria-labelledby="confirmation-customer-heading">
        <h3 id="confirmation-customer-heading">Customer Information</h3>
        <dl className="transaction-detail-list confirmation-details">
          {customerDetails.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
        </dl>
      </section>
      <section className="confirmation-section" aria-labelledby="confirmation-items-heading">
        <h3 id="confirmation-items-heading">Order Items</h3>
        <div className="confirmation-items">
          {cart.map((item) => (
            <div className="confirmation-item" key={item.product_id}>
              <div>
                <strong>{item.product_name}</strong>
                <span>{item.quantity} {item.unit} at {peso.format(Number(item.selling_price))}</span>
              </div>
              <strong>{peso.format(Number(item.selling_price) * item.quantity)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="confirmation-section" aria-labelledby="confirmation-payment-heading">
        <h3 id="confirmation-payment-heading">Payment Details</h3>
        <dl className="transaction-detail-list confirmation-details">
          <div><dt>Payment method</dt><dd>{paymentType}</dd></div>
          <div><dt>Amount paid</dt><dd>{peso.format(amountPaid)}</dd></div>
          {paymentType === 'Credit' && <div><dt>Remaining balance for this sale</dt><dd>{peso.format(remainingBalance)}</dd></div>}
        </dl>
      </section>
      <section className="confirmation-section confirmation-total-section" aria-labelledby="confirmation-total-heading">
        <h3 id="confirmation-total-heading">Transaction Total</h3>
        <dl className="transaction-detail-list confirmation-details">
          <div className="confirmation-total"><dt>Final total</dt><dd>{peso.format(total)}</dd></div>
        </dl>
      </section>
      {error && <p className="sales-feedback error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-action" type="button" onClick={onCancel} disabled={submitting}>Return to Editing</button>
        <button className="primary-action" type="button" onClick={onConfirm} disabled={submitting}>
          {submitting && <span className="sales-submit-spinner" aria-hidden="true" />}
          {submitting ? 'Recording Sale...' : 'Confirm and Record Sale'}
        </button>
      </div>
    </Modal>
  )
}

export default SaleConfirmationModal
