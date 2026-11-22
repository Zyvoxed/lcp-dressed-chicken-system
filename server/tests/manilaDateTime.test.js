import assert from 'node:assert/strict'
import test from 'node:test'
import { toManilaDateTime } from '../utils/manilaDateTime.js'

test('payment timestamps persist Manila wall time on both sides of business midnight', () => {
  assert.equal(toManilaDateTime(new Date('2026-11-19T15:59:59.000Z')), '2026-11-19 23:59:59')
  assert.equal(toManilaDateTime(new Date('2026-11-19T16:00:00.000Z')), '2026-11-20 00:00:00')
})

test('Manila timestamp conversion is independent of the host timezone and rejects invalid dates', () => {
  assert.equal(toManilaDateTime('2026-11-20T02:30:00-05:00'), '2026-11-20 15:30:00')
  assert.throws(() => toManilaDateTime('invalid'), /Invalid date value/)
})
