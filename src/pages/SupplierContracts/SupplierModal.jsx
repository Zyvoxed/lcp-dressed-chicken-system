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
      {fields.map(([label, name]) => (
        <label key={name}>
          {label}
          <input name={name} placeholder={label} value={form[name]} onChange={handleChange} />
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving Supplier' : 'Save Supplier'}
      </button>
    </Modal>
  )
}

export default SupplierModal
