import { authenticatedApiFetch } from './api.js'
import { collectReportPages } from './collectReportPages.js'

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

export function getAllSalesReport(filters = {}, options = {}) {
  return collectReportPages(getSalesReport, filters, options)
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

export function getAllReceivablesReport(options = {}) {
  return collectReportPages(getReceivablesReport, {}, options)
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
