import assert from 'node:assert/strict'
import test from 'node:test'
import { getMonthlyIndexesForYear } from './monthlyChartPeriods.js'

const monthsThrough = (monthCount) => Array.from({ length: monthCount }, (_, index) => index)

test('current-year monthly indexes stop at the selected current month in Manila', () => {
  for (const [date, monthCount] of [
    ['2026-01-15T04:00:00.000Z', 1],
    ['2026-03-15T04:00:00.000Z', 3],
    ['2026-07-15T04:00:00.000Z', 7],
    ['2026-11-15T04:00:00.000Z', 11],
    ['2026-12-15T04:00:00.000Z', 12],
  ]) {
    assert.deepEqual(getMonthlyIndexesForYear(2026, new Date(date)), monthsThrough(monthCount))
  }
})

test('Manila calendar month is used across the UTC month boundary', () => {
  assert.deepEqual(
    getMonthlyIndexesForYear(2026, new Date('2026-01-31T16:30:00.000Z')),
    monthsThrough(2),
  )
})

test('historical years retain all months and future years contain none', () => {
  const now = new Date('2026-07-15T04:00:00.000Z')
  assert.deepEqual(getMonthlyIndexesForYear(2025, now), monthsThrough(12))
  assert.deepEqual(getMonthlyIndexesForYear(2027, now), [])
  assert.deepEqual(getMonthlyIndexesForYear(null, now), [])
})
