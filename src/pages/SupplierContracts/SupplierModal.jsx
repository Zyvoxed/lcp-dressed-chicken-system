import { useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import { createSupplier } from '../../services/supplierService.js'

const fields = [
  ['Supplier Name', 'supplier_name'],
  ['Contact Person', 'contact_person'],
  ['Contact Number', 'contact_number'],
  ['Address', 'address'],
]

const initialForm = {
  supplier_name: '',
  contact_person: '',
  contact_number: '',
  address: '',
}

function SupplierModal({ onClose, onCreated }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')

    try {
      await createSupplier(form)
      await onCreated()
    } catch (requestError) {
      setError(requestError.message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Add Qualified Supplier" onClose={onClose}>
      <div className="supplier-form" aria-busy={saving}>
        {fields.map(([label, name]) => (
          <label key={name}>
            {label}
            <input
              name={name}
              placeholder={label}
              value={form[name]}
              onChange={handleChange}
              disabled={saving}
            />
          </label>
        ))}
        {error && <p className="supplier-form-error" role="alert">{error}</p>}
        <button className="primary-action supplier-save-button" type="button" onClick={handleSave} disabled={saving}>
          {saving && <span className="supplier-submit-spinner" aria-hidden="true" />}
          {saving ? 'Saving Supplier' : 'Save Supplier'}
        </button>
      </div>
    </Modal>
  )
}

export default SupplierModal
