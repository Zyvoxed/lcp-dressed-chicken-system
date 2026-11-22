import { authenticatedApiFetch } from './api.js'

async function request(path, options, fallback) {
  const response = await authenticatedApiFetch(path, options)
  let result
  try { result = await response.json() } catch { throw new Error(fallback) }
  if (!response.ok || !result.success) throw new Error(result.message || fallback)
  return result.data
}

export function getSalesReport(filters = {}, options = {}) {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value) })
  const suffix = query.size ? `?${query.toString()}` : ''
  return request(`/reports/sales${suffix}`, options, 'Unable to retrieve sales report')
}

export async function getAllSalesReport(filters = {}, options = {}) {
  const firstPage = await getSalesReport({ ...filters, page: 1, page_size: 100 }, options)
  const records = [...(firstPage.records ?? [])]
  const totalPages = Number(firstPage.pagination?.total_pages || 0)
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await getSalesReport({ ...filters, page, page_size: 100 }, options)
    records.push(...(next.records ?? []))
  }
  return { ...firstPage, records }
}

export function getSalesReportDetail(saleId, options = {}) {
  return request(`/reports/sales/${saleId}`, options, 'Unable to retrieve transaction details')
}

export function getInventoryReport(options = {}) {
  return request('/reports/inventory', options, 'Unable to retrieve inventory report')
}

export function getReceivablesReport(filters = {}, options = {}) {
  const query = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') query.set(key, value) })
  const suffix = query.size ? `?${query.toString()}` : ''
  return request(`/reports/receivables${suffix}`, options, 'Unable to retrieve receivables report')
}

export async function getAllReceivablesReport(options = {}) {
  const firstPage = await getReceivablesReport({ page: 1, page_size: 100 }, options)
  const records = [...(firstPage.records ?? [])]
  const totalPages = Number(firstPage.pagination?.total_pages || 0)
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await getReceivablesReport({ page, page_size: 100 }, options)
    records.push(...(next.records ?? []))
  }
  return { ...firstPage, records }
}

export function getProductSalesReport(productIds, year, options = {}) {
  const query = new URLSearchParams({ product_ids: productIds.join(',') })
  if (year) query.set('year', year)
  return request(`/reports/product-sales?${query.toString()}`, options, 'Unable to retrieve product sales report')
}

export function logReportExport(reportType) {
  return request('/reports/log', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report_type: reportType }),
  }, 'Unable to log report export')
}
