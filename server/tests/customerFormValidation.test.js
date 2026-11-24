import assert from 'node:assert/strict'
import test from 'node:test'
import {
  customerFieldErrorsFromMessage,
  isValidCustomerContactNumber,
  normalizeCustomerForm,
  validateCustomerForm,
} from '../../src/pages/RecordSales/customerFormValidation.js'

const validForm = {
  customer_name: 'Ana Reyes',
  contact_number: '09171234567',
  address: 'Quezon City',
}

test('requires a trimmed customer name, contact number, and location', () => {
  assert.deepEqual(validateCustomerForm({ customer_name: ' Ana Reyes ', contact_number: '', address: '' }), {
    contact_number: 'Contact number is required.',
    address: 'Location is required.',
  })
  assert.deepEqual(validateCustomerForm({ customer_name: 'Ana Reyes', contact_number: '   ', address: '  ' }), {
    contact_number: 'Contact number is required.',
    address: 'Location is required.',
  })
  assert.deepEqual(validateCustomerForm({ ...validForm, customer_name: '  ' }), {
    customer_name: 'Customer name is required.',
  })
  assert.deepEqual(validateCustomerForm({ ...validForm, customer_name: 'A'.repeat(101) }), {
    customer_name: 'Customer name must not exceed 100 characters.',
  })
})

test('validates contact number type, length, and format', () => {
  assert.deepEqual(validateCustomerForm({
    ...validForm,
    contact_number: '1'.repeat(21),
  }), { contact_number: 'Contact number must not exceed 20 characters.' })
  assert.deepEqual(validateCustomerForm({ ...validForm, contact_number: 'letters only' }), {
    contact_number: 'Enter a valid telephone number.',
  })
  assert.equal(isValidCustomerContactNumber('09171234567'), true)
  assert.equal(isValidCustomerContactNumber('+639171234567'), true)
  assert.equal(isValidCustomerContactNumber('+63 (917) 123-4567'), true)
  assert.equal(isValidCustomerContactNumber('02-8123-4567'), true)
  assert.equal(isValidCustomerContactNumber('555-0100 ext 123'), true)
  assert.equal(isValidCustomerContactNumber('12345'), false)
})

test('normalizes whitespace before sending a valid customer form', () => {
  assert.deepEqual(normalizeCustomerForm({
    customer_name: ' Ana Reyes ',
    contact_number: ' 09171234567 ',
    address: ' Quezon City ',
  }), validForm)
  assert.deepEqual(validateCustomerForm({
    ...validForm,
    address: 'Brgy. San Jose, Cebu City',
  }), {})
})

test('maps backend validation responses to the matching input field', () => {
  assert.deepEqual(customerFieldErrorsFromMessage('Contact number must not exceed 20 characters'), {
    contact_number: 'Contact number must not exceed 20 characters',
  })
  assert.deepEqual(customerFieldErrorsFromMessage('Location is required'), { address: 'Location is required' })
  assert.deepEqual(customerFieldErrorsFromMessage('Unable to save customer'), {})
})
