import Modal from '../Shared/Modal.jsx'
import { peso } from '../../utils/currency.js'
import { formatActivityTimestamp } from '../../utils/activityDateTime.js'

function PaymentConfirmationModal({ customer, credit, amount, submitting, error, onCancel, onConfirm }) {
  return (
    <Modal title="Review Payment" onClose={onCancel} className="payment-confirmation-modal">
      <p className="payment-review-copy">Confirm the customer and credit sale before recording this payment.</p>
      <section className="payment-review-section" aria-labelledby="payment-customer-heading">
        <h3 id="payment-customer-heading">Customer Information</h3>
        <dl className="transaction-detail-list">
          <div><dt>Customer</dt><dd>{customer.customer_name}</dd></div>
          {customer.contact_number && <div><dt>Contact number</dt><dd>{customer.contact_number}</dd></div>}
          <div><dt>Total outstanding balance</dt><dd>{peso.format(Number(customer.current_balance))}</dd></div>
        </dl>
      </section>
      <section className="payment-review-section" aria-labelledby="payment-details-heading">
        <h3 id="payment-details-heading">Payment Details</h3>
        <dl className="transaction-detail-list">
          <div><dt>Credit sale</dt><dd>OR-{credit.sale_id}</dd></div>
          {credit.sale_date && <div><dt>Sale date</dt><dd>{formatActivityTimestamp(credit.sale_date).dateTime}</dd></div>}
          <div><dt>Sale remaining balance</dt><dd>{peso.format(Number(credit.remaining_balance))}</dd></div>
          <div className="confirmation-total"><dt>Payment amount</dt><dd>{peso.format(Number(amount))}</dd></div>
        </dl>
      </section>
      {error && <p className="payment-feedback error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-action" type="button" onClick={onCancel} disabled={submitting}>Return to Editing</button>
        <button className="primary-action" type="button" onClick={onConfirm} disabled={submitting}>
          {submitting && <span className="payment-submit-spinner" aria-hidden="true" />}
          {submitting ? 'Recording Payment...' : 'Confirm Payment'}
        </button>
      </div>
    </Modal>
  )
}

export default PaymentConfirmationModal
