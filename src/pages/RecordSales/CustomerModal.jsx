import { useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import { createCustomer } from '../../services/customerService.js'

function CustomerModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ customer_name: '', contact_number: '', address: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const customer = await createCustomer(form)
      await onCreated(customer.customer_id)
    } catch (requestError) {
      setError(requestError.message)
      setSaving(false)
    }
  }

  return (
    <Modal title="Quick Register Customer" onClose={onClose}>
      <label>Customer Name<input name="customer_name" value={form.customer_name} onChange={change} placeholder="Customer Name" /></label>
      <label>Contact Number<input name="contact_number" value={form.contact_number} onChange={change} placeholder="Contact Number" /></label>
      <label>Address<input name="address" value={form.address} onChange={change} placeholder="Address" /></label>
      {error && <p role="alert">{error}</p>}
      <button className="primary-action" type="button" onClick={save} disabled={saving}>{saving ? 'Saving Customer' : 'Save Customer'}</button>
    </Modal>
  )
}

export default CustomerModal
