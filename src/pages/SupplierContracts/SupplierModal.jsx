import { useRef, useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import { createSupplier, updateSupplier } from '../../services/supplierService.js'
import { useToast } from '../../context/ToastContext.jsx'

const emptyForm = {
  supplier_name: '',
  contact_person: '',
  contact_number: '',
  address: '',
}

function supplierDetails(form) {
  return [
    { label: 'Supplier name', value: form.supplier_name },
    { label: 'Contact person', value: form.contact_person || 'Not provided' },
    { label: 'Contact number', value: form.contact_number },
    { label: 'Address', value: form.address },
  ]
}

function normalizeForm(form) {
  return Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]))
}

function validateForm(form) {
  const errors = {}

  if (!form.supplier_name) errors.supplier_name = 'Supplier name is required.'
  else if (form.supplier_name.length > 100) errors.supplier_name = 'Supplier name must be 100 characters or fewer.'

  if (form.contact_person.length > 100) errors.contact_person = 'Contact person must be 100 characters or fewer.'

  if (!form.contact_number) errors.contact_number = 'Contact number is required.'
  else if (form.contact_number.length > 20) errors.contact_number = 'Contact number must be 20 characters or fewer.'

  if (!form.address) errors.address = 'Address is required.'

  return errors
}

function SupplierModal({ supplier = null, onClose, onSaved }) {
  const editing = Boolean(supplier)
  const { showSuccess, showError, showWarning } = useToast()
  const [form, setForm] = useState(() => supplier
    ? {
        supplier_name: supplier.supplier_name || '',
        contact_person: supplier.contact_person || '',
        contact_number: supplier.contact_number || '',
        address: supplier.address || '',
      }
    : emptyForm)
  const [step, setStep] = useState('form')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [success, setSuccess] = useState(null)
  const submissionLock = useRef(false)

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
    setFieldErrors((current) => ({ ...current, [name]: '' }))
  }

  function reviewSupplier(event) {
    event.preventDefault()
    const normalizedForm = normalizeForm(form)
    const nextErrors = validateForm(normalizedForm)
    setForm(normalizedForm)
    setFieldErrors(nextErrors)

    const firstError = Object.values(nextErrors)[0]
    if (firstError) {
      setError('Please correct the highlighted supplier information.')
      showError(firstError)
      const invalidField = Object.keys(nextErrors)[0]
      event.currentTarget.elements.namedItem(invalidField)?.focus()
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
      const result = editing
        ? await updateSupplier(supplier.supplier_id, normalizeForm(form))
        : await createSupplier(normalizeForm(form))
      const refreshWarning = await onSaved?.()
      showSuccess(`${form.supplier_name.trim()} was ${editing ? 'updated' : 'added'} successfully.`)
      if (refreshWarning) showWarning(refreshWarning)
      setSuccess({ result, details: supplierDetails(normalizeForm(form)), refreshWarning })
      setStep('success')
    } catch (requestError) {
      showError(requestError.message || `Unable to ${editing ? 'update' : 'create'} supplier`)
      setError(requestError.message || `Unable to ${editing ? 'update' : 'create'} supplier`)
    } finally {
      submissionLock.current = false
      setSaving(false)
    }
  }

  if (step === 'success' && success) {
    return <TransactionSuccessModal
      title={editing ? 'Supplier Updated Successfully!' : 'Supplier Added Successfully!'}
      message={editing
        ? 'The supplier information has been updated. Existing delivery history remains linked to this supplier.'
        : 'The supplier has been saved and is available for future Stock In deliveries.'}
      details={[
        { label: 'Supplier reference', value: `SUP-${success.result.supplier_id}` },
        ...success.details,
      ]}
      notice={success.refreshWarning}
      onDone={onClose}
    />
  }

  if (step === 'review') {
    return <Modal title={editing ? 'Review Supplier Changes' : 'Review Supplier'} onClose={onClose} className="supplier-review-modal">
      <p className="supplier-modal-copy">Confirm the supplier information before saving it.</p>
      <dl className="transaction-detail-list">
        {supplierDetails(normalizeForm(form)).map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}
      </dl>
      {error && <p className="supplier-form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="secondary-action" type="button" disabled={saving} onClick={() => { setStep('form'); setError('') }}>Back</button>
        <button className="primary-action supplier-save-button" type="button" disabled={saving} onClick={confirmSupplier}>
          {saving && <span className="supplier-submit-spinner" aria-hidden="true" />}
          {saving ? 'Saving Supplier…' : editing ? 'Confirm Changes' : 'Confirm Supplier'}
        </button>
      </div>
    </Modal>
  }

  return (
    <Modal title={editing ? 'Edit Supplier' : 'Add Qualified Supplier'} onClose={onClose} className="supplier-form-modal">
      <form className="supplier-form" onSubmit={reviewSupplier} noValidate aria-busy={saving}>
        <p className="supplier-modal-copy">
          {editing ? 'Update the supplier contact information used by the existing Stock In workflow.' : 'Add an active supplier that can be selected in the existing Stock In workflow.'}
        </p>
        <label>
          <span>Supplier Name <b className="required-marker" aria-hidden="true">*</b></span>
          <input
            name="supplier_name"
            placeholder="Supplier name"
            value={form.supplier_name}
            onChange={handleChange}
            maxLength={100}
            autoFocus
            required
            aria-invalid={Boolean(fieldErrors.supplier_name)}
            aria-describedby={fieldErrors.supplier_name ? 'supplier-name-error' : undefined}
          />
          {fieldErrors.supplier_name && <span id="supplier-name-error" className="supplier-form-error" role="alert">{fieldErrors.supplier_name}</span>}
        </label>
        <label>
          <span>Contact Person <span className="optional-label">Optional</span></span>
          <input name="contact_person" placeholder="Contact person" value={form.contact_person} onChange={handleChange} maxLength={100} aria-invalid={Boolean(fieldErrors.contact_person)} aria-describedby={fieldErrors.contact_person ? 'supplier-contact-person-error' : undefined} />
          {fieldErrors.contact_person && <span id="supplier-contact-person-error" className="supplier-form-error" role="alert">{fieldErrors.contact_person}</span>}
        </label>
        <label>
          <span>Contact Number <b className="required-marker" aria-hidden="true">*</b></span>
          <input
            name="contact_number"
            inputMode="tel"
            placeholder="Supplier contact number"
            value={form.contact_number}
            onChange={handleChange}
            maxLength={20}
            required
            aria-invalid={Boolean(fieldErrors.contact_number)}
            aria-describedby={fieldErrors.contact_number ? 'supplier-contact-number-error' : undefined}
          />
          {fieldErrors.contact_number && <span id="supplier-contact-number-error" className="supplier-form-error" role="alert">{fieldErrors.contact_number}</span>}
        </label>
        <label>
          <span>Address <b className="required-marker" aria-hidden="true">*</b></span>
          <textarea
            name="address"
            placeholder="Supplier address"
            value={form.address}
            onChange={handleChange}
            required
            aria-invalid={Boolean(fieldErrors.address)}
            aria-describedby={fieldErrors.address ? 'supplier-address-error' : undefined}
          />
          {fieldErrors.address && <span id="supplier-address-error" className="supplier-form-error" role="alert">{fieldErrors.address}</span>}
        </label>
        {error && <p className="supplier-form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="submit">{editing ? 'Review Changes' : 'Review Supplier'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default SupplierModal
