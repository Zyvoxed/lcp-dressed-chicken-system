import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IdempotencyKeyConflictError,
  getIdempotencyKey,
  hashRequestPayload,
  reserveIdempotencyKey,
  readIdempotentResponse,
} from '../utils/idempotency.js'

test('idempotency keys require a safe non-empty header within the supported length', () => {
  assert.equal(getIdempotencyKey({ get: () => '  request-123  ' }), 'request-123')
  for (const value of [undefined, '', '  ', 'key with spaces', 'x'.repeat(129)]) {
    assert.throws(() => getIdempotencyKey({ get: () => value }), {
      message: 'A valid Idempotency-Key header is required',
    })
  }
})

test('request payload hashes are stable for identical normalized payloads', () => {
  const payload = {
    payment_type: 'Credit',
    customer_id: 7,
    amount_paid_cents: '0',
    items: [{ product_id: 2, quantity_thousandths: '1125' }],
  }
  assert.deepEqual(hashRequestPayload(payload), hashRequestPayload(payload))
  assert.notDeepEqual(
    hashRequestPayload(payload),
    hashRequestPayload({ ...payload, customer_id: 8 }),
  )
})

test('reservation recognizes only the named idempotency scope collision', async () => {
  const idempotency = {
    userId: 7,
    operation: 'sale',
    key: 'sale-key',
    payloadHash: hashRequestPayload({ sale_id: 42 }),
  }
  const duplicateReservation = Object.assign(
    new Error("Duplicate entry for key 'uq_idempotency_user_operation_key'"),
    { code: 'ER_DUP_ENTRY' },
  )
  const reservationConnection = {
    async execute() { throw duplicateReservation },
  }

  await assert.rejects(
    reserveIdempotencyKey(reservationConnection, idempotency),
    (error) => error instanceof IdempotencyKeyConflictError
      && error.status === 409
      && error.cause === duplicateReservation,
  )

  const unrelatedDuplicate = Object.assign(
    new Error("Duplicate entry for key 'uq_sales_receipt'"),
    { code: 'ER_DUP_ENTRY' },
  )
  await assert.rejects(
    reserveIdempotencyKey({ async execute() { throw unrelatedDuplicate } }, idempotency),
    (error) => error === unrelatedDuplicate,
  )
})

test('stored idempotent responses replay only when the payload matches', () => {
  const payloadHash = hashRequestPayload({ sale_id: 42, amount_paid_cents: '1500' })
  const record = {
    request_hash: payloadHash,
    response_status: 201,
    response_body: JSON.stringify({ success: true, data: { sale_id: 42 } }),
  }
  assert.deepEqual(readIdempotentResponse(record, payloadHash), {
    kind: 'replay',
    status: 201,
    body: { success: true, data: { sale_id: 42 } },
  })
  assert.equal(
    readIdempotentResponse(record, hashRequestPayload({ sale_id: 42, amount_paid_cents: '1600' })).kind,
    'payload-mismatch',
  )
  assert.deepEqual(readIdempotentResponse(null, payloadHash), { kind: 'missing' })
})

test('an incomplete stored response is not treated as a verified payload conflict', () => {
  const storedHash = hashRequestPayload({ sale_id: 42, amount_paid_cents: '1500' })
  assert.throws(() => readIdempotentResponse({
    request_hash: storedHash,
    response_status: null,
    response_body: null,
  }, hashRequestPayload({ sale_id: 42, amount_paid_cents: '1600' })), /incomplete/)
})
