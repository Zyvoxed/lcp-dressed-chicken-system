import assert from 'node:assert/strict'
import test from 'node:test'
import pool from '../config/database.js'
import { createCustomer } from '../controllers/customerController.js'

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

async function withExecute(execute, callback) {
  const original = pool.execute
  pool.execute = execute
  try { await callback() } finally { pool.execute = original }
}

test('customer creation trims required profile fields before inserting them', async () => {
  const response = responseRecorder()
  let query = ''
  let parameters

  await withExecute(async (sql, values) => {
    query = sql
    parameters = values
    return [{ insertId: 21 }]
  }, () => createCustomer({
    body: { customer_name: '  Ana Reyes  ', contact_number: ' 09171234567 ', address: '  Quezon City ' },
  }, response))

  assert.equal(response.statusCode, 201)
  assert.deepEqual(parameters, ['Ana Reyes', '09171234567', 'Quezon City'])
  assert.match(query, /INSERT INTO customers \(customer_name, contact_number, address\)/)
  assert.deepEqual(response.payload.data, { customer_id: 21 })
})

test('customer creation rejects blank and whitespace-only names before database access', async () => {
  for (const customerName of ['', '   ', undefined]) {
    const response = responseRecorder()
    await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
      body: { customer_name: customerName, contact_number: '09171234567', address: 'Quezon City' },
    }, response))
    assert.equal(response.statusCode, 400)
    assert.equal(response.payload.message, 'Customer name is required')
  }
})

test('customer creation rejects invalid field types and overlong values', async () => {
  const invalidName = responseRecorder()
  await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
    body: { customer_name: 'A'.repeat(101) },
  }, invalidName))
  assert.equal(invalidName.statusCode, 400)
  assert.equal(invalidName.payload.message, 'Customer name must not exceed 100 characters')

  const invalidContact = responseRecorder()
  await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
    body: { customer_name: 'Valid Name', contact_number: '1'.repeat(21), address: 'Quezon City' },
  }, invalidContact))
  assert.equal(invalidContact.statusCode, 400)
  assert.equal(invalidContact.payload.message, 'Contact number must not exceed 20 characters')

  const invalidPhone = responseRecorder()
  await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
    body: { customer_name: 'Valid Name', contact_number: 'not a phone', address: 'Quezon City' },
  }, invalidPhone))
  assert.equal(invalidPhone.statusCode, 400)
  assert.equal(invalidPhone.payload.message, 'Contact number must be a valid telephone number')
})

test('customer creation requires contact number and location', async () => {
  const missingContact = responseRecorder()
  await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
    body: { customer_name: 'Valid Name', address: 'Quezon City' },
  }, missingContact))
  assert.equal(missingContact.statusCode, 400)
  assert.equal(missingContact.payload.message, 'Contact number is required')

  const blankContact = responseRecorder()
  await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
    body: { customer_name: 'Valid Name', contact_number: '  ', address: 'Quezon City' },
  }, blankContact))
  assert.equal(blankContact.statusCode, 400)
  assert.equal(blankContact.payload.message, 'Contact number is required')

  const missingLocation = responseRecorder()
  await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
    body: { customer_name: 'Valid Name', contact_number: '09171234567' },
  }, missingLocation))
  assert.equal(missingLocation.statusCode, 400)
  assert.equal(missingLocation.payload.message, 'Location is required')

  const blankLocation = responseRecorder()
  await withExecute(async () => { throw new Error('Database should not be queried') }, () => createCustomer({
    body: { customer_name: 'Valid Name', contact_number: '09171234567', address: '   ' },
  }, blankLocation))
  assert.equal(blankLocation.statusCode, 400)
  assert.equal(blankLocation.payload.message, 'Location is required')
})
