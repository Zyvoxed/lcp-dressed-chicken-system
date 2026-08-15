import Modal from '../Shared/Modal.jsx'

function SupplierModal({ onClose }) {
  return (
    <Modal title="Add Qualified Supplier" onClose={onClose}>
      {['Supplier Name', 'Contact Person', 'Contact Number', 'Address'].map((field) => (
        <label key={field}>
          {field}
          <input placeholder={field} />
        </label>
      ))}
      <button className="primary-action" type="button" onClick={onClose}>
        Save Supplier
      </button>
    </Modal>
  )
}

export default SupplierModal
