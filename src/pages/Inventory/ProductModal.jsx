import Modal from '../Shared/Modal.jsx'

function ProductModal({ onClose }) {
  return (
    <Modal title="Register Product Listing" onClose={onClose}>
      {['Product Name', 'Category', 'Unit Metric', 'Selling Price', 'Initial Stock', 'Reorder Level'].map((field) => (
        <label key={field}>
          {field}
          <input placeholder={field} />
        </label>
      ))}
      <div className="modal-actions">
        <button className="secondary-action" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary-action" type="button" onClick={onClose}>
          Register Product Listing
        </button>
      </div>
    </Modal>
  )
}

export default ProductModal
