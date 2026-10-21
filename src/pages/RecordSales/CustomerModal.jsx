import { useRef, useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import { createCustomer } from '../../services/customerService.js'

const initialForm = { customer_name: '', contact_number: '', address: '' }

function CustomerModal({ onClose, onCreated }) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [refreshWarning, setRefreshWarning] = useState('')
  const [savedCustomer, setSavedCustomer] = useState(null)
  const submissionLock = useRef(false)

  function change(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
    setError('')
  }

  async function save(event) {
    event.preventDefault()
    if (submissionLock.current) return
    if (!form.customer_name.trim()) {
      setError('Customer name is required.')
      return
    }

    submissionLock.current = true
    setSaving(true)
    setError('')
    try {
      const result = await createCustomer({
        customer_name: form.customer_name.trim(),
        contact_number: form.contact_number.trim(),
        address: form.address.trim(),
      })
      const customer = { ...form, customer_name: form.customer_name.trim(), customer_id: result.customer_id }
      setSavedCustomer(customer)
      try {
        await onCreated(result.customer_id)
      } catch (refreshError) {
        setRefreshWarning(`Customer saved, but the customer list could not be refreshed: ${refreshError.message}`)
      }
    } catch (requestError) {
      setError(requestError.message)
      submissionLock.current = false
      setSaving(false)
    }
  }

  if (savedCustomer) {
    const details = [
      { label: 'Customer reference', value: `CUS-${savedCustomer.customer_id}` },
      { label: 'Customer name', value: savedCustomer.customer_name },
      ...(savedCustomer.contact_number ? [{ label: 'Contact number', value: savedCustomer.contact_number }] : []),
      ...(savedCustomer.address ? [{ label: 'Address', value: savedCustomer.address }] : []),
    ]
    return (
      <TransactionSuccessModal
        title="Customer Added Successfully!"
        message="The customer record has been created and is ready for use."
        details={details}
        notice={refreshWarning}
        onDone={onClose}
      />
    )
  }

  return (
    <Modal title="Add Customer" onClose={() => { if (!saving) onClose() }} className="customer-form-modal">
      <form className="customer-form" onSubmit={save} noValidate aria-busy={saving}>
        <label htmlFor="customer-name">
          <span>Customer Name <b className="required-marker" aria-hidden="true">*</b></span>
          <input id="customer-name" name="customer_name" value={form.customer_name} onChange={change} maxLength={100} autoComplete="name" disabled={saving} required />
        </label>
        <label htmlFor="customer-contact">
          Contact Number <span className="optional-label">Optional</span>
          <input id="customer-contact" name="contact_number" value={form.contact_number} onChange={change} maxLength={20} inputMode="tel" autoComplete="tel" disabled={saving} />
        </label>
        <label htmlFor="customer-address">
          Address <span className="optional-label">Optional</span>
          <textarea id="customer-address" name="address" value={form.address} onChange={change} rows={3} autoComplete="street-address" disabled={saving} />
        </label>
        {error && <p className="sales-feedback error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving && <span className="sales-submit-spinner" aria-hidden="true" />}
            {saving ? 'Saving Customer...' : 'Save Customer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default CustomerModal
