import { CircleCheck } from 'lucide-react'
import Modal from './Modal.jsx'

function TransactionSuccessModal({ type, title: customTitle, message: customMessage, details, notice, onDone }) {
  const isPayment = type === 'payment'
  const title = customTitle || (isPayment ? 'Payment Recorded Successfully!' : 'Sale Recorded Successfully!')
  const message = customMessage || (isPayment
    ? 'The payment has been processed and recorded successfully.'
    : 'The sales transaction has been completed and recorded successfully.')

  return (
    <Modal title={title} onClose={onDone} className="transaction-success-modal">
      <div className="transaction-success-intro">
        <CircleCheck size={54} strokeWidth={1.8} aria-hidden="true" />
        <p>{message}</p>
      </div>
      <dl className="transaction-detail-list">
        {details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        ))}
      </dl>
      {notice && <p className="transaction-success-notice" role="status">{notice}</p>}
      <button className="primary-action transaction-done-button" type="button" onClick={onDone}>Done</button>
    </Modal>
  )
}

export default TransactionSuccessModal
