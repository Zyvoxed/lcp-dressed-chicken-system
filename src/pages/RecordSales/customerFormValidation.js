export function validateCustomerForm(form) {
  const errors = {}
  const name = typeof form?.customer_name === 'string' ? form.customer_name.trim() : ''
  const contact = typeof form?.contact_number === 'string' ? form.contact_number.trim() : null
  const address = typeof form?.address === 'string' ? form.address.trim() : null

  if (!name) errors.customer_name = 'Customer name is required.'
  else if (name.length > 100) errors.customer_name = 'Customer name must not exceed 100 characters.'

  if (contact === null || !contact) errors.contact_number = 'Contact number is required.'
  else if (contact.length > 20) errors.contact_number = 'Contact number must not exceed 20 characters.'
  else if (!isValidCustomerContactNumber(contact)) errors.contact_number = 'Enter a valid telephone number.'

  if (address === null || !address) errors.address = 'Location is required.'
  return errors
}

export function isValidCustomerContactNumber(value) {
  if (typeof value !== 'string') return false
  const contact = value.trim()
  if (!contact || contact.length > 20) return false
  const coreNumber = contact.replace(/\s*(?:ext\.?|x)\s*\d{1,5}$/i, '')
  const digits = coreNumber.replace(/\D/g, '')
  return /^\+?[\d\s().-]+$/.test(coreNumber) && digits.length >= 7 && digits.length <= 15
}

export function normalizeCustomerForm(form) {
  return {
    customer_name: form.customer_name.trim(),
    contact_number: form.contact_number.trim(),
    address: form.address.trim(),
  }
}

export function customerFieldErrorsFromMessage(message) {
  const text = String(message || '')
  const field = ['customer_name', 'contact_number', 'address'].find((name) => {
    const label = name === 'customer_name' ? 'customer name' : name === 'contact_number' ? 'contact number' : 'location'
    return text.toLowerCase().includes(label)
  })
  return field ? { [field]: text } : {}
}
