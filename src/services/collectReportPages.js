// Downloads retain the first page's summary while accumulating every displayed record.
export async function collectReportPages(fetchPage, filters, options) {
  const firstPage = await fetchPage({ ...filters, page: 1, page_size: 100 }, options)
  const records = [...(firstPage.records ?? [])]
  const totalPages = Number(firstPage.pagination?.total_pages || 0)
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage({ ...filters, page, page_size: 100 }, options)
    records.push(...(next.records ?? []))
  }
  return { ...firstPage, records }
}
