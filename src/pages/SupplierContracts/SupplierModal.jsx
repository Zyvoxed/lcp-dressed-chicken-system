import { useRef, useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import { createSupplier } from '../../services/supplierService.js'

const initialForm = {
  supplier_name: '',
  contact_person: '',
  contact_number: '',
  address: '',
}

function supplierDetails(form) {
  return [
    { label: 'Supplier name', value: form.supplier_name.trim() },
    { label: 'Contact person', value: form.contact_person.trim() || 'Not provided' },
    { label: 'Contact number', value: form.contact_number.trim() || 'Not provided' },
    { label: 'Address', value: form.address.trim() || 'Not provided' },
  ]
}

function SupplierModal({ onClose, onCreated }) {
  const [form, setForm] = useState(initialForm)
  const [step, setStep] = useState('form')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const submissionLock = useRef(false)

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
  }

  function reviewSupplier(event) {
    event.preventDefault()
    if (!form.supplier_name.trim()) {
      setError('Supplier name is required.')
      return
    }
    setError('')
    setStep('review')
  }

  async function confirmSupplier() {
    if (submissionLock.current) return
    submissionLock.current = true
    setSaving(true)
    setError('')

    try {
      const result = await createSupplier(form)
      const refreshWarning = await onCreated?.()
      setSuccess({ result, details: supplierDetails(form), refreshWarning })
      setStep('success')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      submissionLock.current = false
      setSaving(false)
    }
  }

  if (step === 'success' && success) {
    return <TransactionSuccessModal
      title="Supplier Added Successfully!"
      message="The supplier has been saved and is available for future Stock In deliveries."
      details={[
        { label: 'Supplier reference', value: `SUP-${success.result.supplier_id}` },
        ...success.details,
      ]}
      notice={success.refreshWarning}
      onDone={onClose}
    />
  }

  if (step === 'review') {
    return <Modal title="Review Supplier" onClose={onClose} className="supplier-review-modal">
      <p className="supplier-modal-copy">Confirm the supplier information before saving it.</p>
      <dl className="transaction-detail-list">
        {supplierDetails(form).map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
      </dl>
      {error && <p className="supplier-form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-action" type="button" disabled={saving} onClick={() => { setStep('form'); setError('') }}>Back</button>
        <button className="primary-action supplier-save-button" type="button" disabled={saving} onClick={confirmSupplier}>
          {saving && <span className="supplier-submit-spinner" aria-hidden="true" />}
          {saving ? 'Saving Supplier…' : 'Confirm Supplier'}
        </button>
      </div>
    </Modal>
  }

  return (
    <Modal title="Add Qualified Supplier" onClose={onClose} className="supplier-form-modal">
      <form className="supplier-form" onSubmit={reviewSupplier} noValidate aria-busy={saving}>
        <p className="supplier-modal-copy">Add an active supplier that can be selected in the existing Stock In workflow.</p>
        <label>
          <span>Supplier Name <b className="required-marker" aria-hidden="true">*</b></span>
          <input name="supplier_name" placeholder="Supplier name" value={form.supplier_name} onChange={handleChange} autoFocus required />
        </label>
        <label>Contact Person<input name="contact_person" placeholder="Optional contact person" value={form.contact_person} onChange={handleChange} /></label>
        <label>Contact Number<input name="contact_number" inputMode="tel" placeholder="Optional contact number" value={form.contact_number} onChange={handleChange} /></label>
        <label>Address<textarea name="address" placeholder="Optional supplier address" value={form.address} onChange={handleChange} /></label>
        {error && <p className="supplier-form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="submit">Review Supplier</button>
        </div>
      </form>
    </Modal>
  )
}

export default SupplierModal
