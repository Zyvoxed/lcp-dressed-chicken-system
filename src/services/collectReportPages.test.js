import assert from 'node:assert/strict'
import test from 'node:test'
import { collectReportPages } from './collectReportPages.js'

test('collectReportPages fetches sequential pages with the same filters and request options', async () => {
  const calls = []
  const signal = new AbortController().signal
  const fetchPage = async (filters, options) => {
    calls.push({ filters, options })
    return filters.page === 1
      ? { records: [{ id: 1 }], summary: { total: 2 }, pagination: { total_pages: 2 } }
      : { records: [{ id: 2 }], summary: { total: 1 }, pagination: { total_pages: 2 } }
  }

  const report = await collectReportPages(fetchPage, { status: 'Paid' }, { signal })

  assert.deepEqual(report.records, [{ id: 1 }, { id: 2 }])
  assert.deepEqual(report.summary, { total: 2 })
  assert.deepEqual(report.pagination, { total_pages: 2 })
  assert.deepEqual(calls.map(({ filters }) => filters), [
    { status: 'Paid', page: 1, page_size: 100 },
    { status: 'Paid', page: 2, page_size: 100 },
  ])
  assert.ok(calls.every(({ options }) => options.signal === signal))
})

test('collectReportPages returns the first response unchanged when there are no records or pages', async () => {
  const firstPage = { records: undefined, summary: { total: 0 }, pagination: { total_pages: 0 } }
  let calls = 0
  const report = await collectReportPages(async () => {
    calls += 1
    return firstPage
  }, {}, {})

  assert.equal(calls, 1)
  assert.deepEqual(report, { ...firstPage, records: [] })
})
