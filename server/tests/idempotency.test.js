import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getIdempotencyKey,
  hashRequestPayload,
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
