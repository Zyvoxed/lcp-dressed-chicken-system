import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getBusinessCalendarDate,
  getBusinessDateTimeLocal,
  getStockInCalendarDate,
  isStockInDateAllowed,
} from '../../shared/stockInDate.js'

test('Stock-In form date helpers format in Manila time and allow past dates and today', () => {
  const now = new Date('2026-11-19T02:00:00.000Z')
  assert.equal(getBusinessCalendarDate(now), '2026-11-19')
  assert.equal(getBusinessDateTimeLocal(now), '2026-11-19T10:00')

  for (const date of ['2026-11-18T12:00', '2026-10-31T12:00', '2025-12-31T12:00', '2026-11-19T23:59']) {
    assert.equal(isStockInDateAllowed(date, now), true, date)
  }
})

test('Stock-In form rejects future, malformed, and impossible dates', () => {
  const now = new Date('2026-11-19T02:00:00.000Z')
  for (const date of ['2026-11-20T00:00', '2026-11-30T10:00', '2027-01-01T10:00', '2026-02-30T10:00', 'bad-date']) {
    assert.equal(isStockInDateAllowed(date, now), false, date)
  }
  assert.equal(getStockInCalendarDate('2026-02-30T10:00'), null)
})

test('explicit timestamp offsets are compared using their Manila calendar date', () => {
  const now = new Date('2026-11-19T02:00:00.000Z')
  assert.equal(isStockInDateAllowed('2026-11-19T15:59:00Z', now), true)
  assert.equal(isStockInDateAllowed('2026-11-19T16:00:00Z', now), false)
})
