import { useRef, useState } from 'react'
import Modal from '../Shared/Modal.jsx'
import TransactionSuccessModal from '../Shared/TransactionSuccessModal.jsx'
import { createCustomer, updateCustomer } from '../../services/customerService.js'
import { useToast } from '../../context/ToastContext.jsx'
import { customerFieldErrorsFromMessage, normalizeCustomerForm, validateCustomerForm } from './customerFormValidation.js'

const initialForm = { customer_name: '', contact_number: '', address: '' }

function customerForm(customer) {
  if (!customer) return initialForm
  return {
    customer_name: customer.customer_name || '',
    contact_number: customer.contact_number || '',
    address: customer.address || '',
  }
}

function CustomerModal({ onClose, onCreated, onUpdated, customer = null }) {
  const { showSuccess, showError, showWarning } = useToast()
  const editing = Boolean(customer?.customer_id)
  const [form, setForm] = useState(() => customerForm(customer))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [refreshWarning, setRefreshWarning] = useState('')
  const [savedCustomer, setSavedCustomer] = useState(null)
  const submissionLock = useRef(false)

  function change(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setError('')
    setFieldErrors((current) => {
      if (!current[name]) return current
      const next = { ...current }
      delete next[name]
      return next
    })
  }

  async function save(event) {
    event.preventDefault()
    if (submissionLock.current) return
    const validationErrors = validateCustomerForm(form)
    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors)
      const message = Object.values(validationErrors)[0]
      setError(message)
      showError(message)
      return
    }

    submissionLock.current = true
    setSaving(true)
    setError('')
    try {
      const payload = normalizeCustomerForm(form)
      const result = editing
        ? await updateCustomer(customer.customer_id, payload)
        : await createCustomer(payload)
      const saved = editing
        ? result
        : { ...payload, customer_id: result.customer_id }
      setSavedCustomer(saved)
      showSuccess(editing ? `${saved.customer_name} was updated successfully.` : `${saved.customer_name} was added successfully.`)
      try {
        if (editing) await onUpdated(saved)
        else await onCreated(result.customer_id)
      } catch (refreshError) {
        setRefreshWarning(`Customer saved, but the customer list could not be refreshed: ${refreshError.message}`)
        showWarning(`Customer saved, but the customer list could not be refreshed: ${refreshError.message}`)
      }
    } catch (requestError) {
      showError(requestError.message || 'Unable to save customer')
      setError(requestError.message)
      setFieldErrors(customerFieldErrorsFromMessage(requestError.message))
      submissionLock.current = false
      setSaving(false)
    }
  }

  if (savedCustomer) {
    const details = [
      { label: 'Customer reference', value: `CUS-${savedCustomer.customer_id}` },
      { label: 'Customer name', value: savedCustomer.customer_name },
      ...(savedCustomer.contact_number ? [{ label: 'Contact number', value: savedCustomer.contact_number }] : []),
      ...(savedCustomer.address ? [{ label: 'Location', value: savedCustomer.address }] : []),
    ]
    return (
      <TransactionSuccessModal
        title={editing ? 'Customer Updated Successfully!' : 'Customer Added Successfully!'}
        message={editing ? 'The customer information has been updated.' : 'The customer record has been created and is ready for use.'}
        details={details}
        notice={refreshWarning}
        onDone={onClose}
      />
    )
  }

  return (
    <Modal title={editing ? 'Edit Customer' : 'Add Customer'} onClose={() => { if (!saving) onClose() }} className="customer-form-modal">
      <form className="customer-form" onSubmit={save} noValidate aria-busy={saving}>
        <label htmlFor="customer-name">
          <span>Customer Name <b className="required-marker" aria-hidden="true">*</b></span>
          <input id="customer-name" name="customer_name" value={form.customer_name} onChange={change} maxLength={100} autoComplete="name" disabled={saving} required aria-invalid={Boolean(fieldErrors.customer_name)} aria-describedby={fieldErrors.customer_name ? 'customer-name-error' : undefined} />
          {fieldErrors.customer_name && <span className="customer-field-error" id="customer-name-error">{fieldErrors.customer_name}</span>}
        </label>
        <label htmlFor="customer-contact">
          <span>Contact Number <b className="required-marker" aria-hidden="true">*</b></span>
          <input id="customer-contact" name="contact_number" value={form.contact_number} onChange={change} maxLength={20} inputMode="tel" autoComplete="tel" disabled={saving} required aria-invalid={Boolean(fieldErrors.contact_number)} aria-describedby={fieldErrors.contact_number ? 'customer-contact-error' : undefined} />
          {fieldErrors.contact_number && <span className="customer-field-error" id="customer-contact-error">{fieldErrors.contact_number}</span>}
        </label>
        <label htmlFor="customer-address">
          <span>Location <b className="required-marker" aria-hidden="true">*</b></span>
          <textarea id="customer-address" name="address" value={form.address} onChange={change} rows={3} autoComplete="street-address" disabled={saving} required aria-invalid={Boolean(fieldErrors.address)} aria-describedby={fieldErrors.address ? 'customer-address-error' : undefined} />
          {fieldErrors.address && <span className="customer-field-error" id="customer-address-error">{fieldErrors.address}</span>}
        </label>
        {error && <p className="sales-feedback error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="secondary-action" type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving && <span className="sales-submit-spinner" aria-hidden="true" />}
            {saving ? 'Saving Customer...' : editing ? 'Save Changes' : 'Save Customer'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default CustomerModal
