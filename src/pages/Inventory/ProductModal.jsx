import Modal from '../Shared/Modal.jsx'

function ProductModal({ onClose }) {
  return (
    <Modal title="Add Product" onClose={onClose}>
      {['Product Name', 'Category', 'Unit', 'Selling Price', 'Initial Stock', 'Low Stock Level'].map((field) => (
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
          Add Product
        </button>
      </div>
    </Modal>
  )
}

export default ProductModal
