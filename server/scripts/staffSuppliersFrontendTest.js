import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import {
  cleanupBrowserSession,
  closeViteServer,
  createAssertionTracker,
  createScreenshotRunDirectory,
  findBrowser,
  reportBrowserDiagnostics,
  removeTemporaryRoot,
  startBrowser,
} from './browserTestUtils.js'

const assertions = createAssertionTracker()
const assert = (condition, message) => assertions.check(condition, message)
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const screenshotRoot = await createScreenshotRunDirectory(projectRoot, 'staff-suppliers-ui')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lcp-staff-suppliers-ui-'))
const safeTempRoot = `${resolve(tmpdir())}${sep}`
let browserSession
let vite

try {
  assert(resolve(temporaryRoot).startsWith(safeTempRoot), 'Unsafe temporary Staff Suppliers UI directory')
  const browserPath = findBrowser()
  assert(browserPath, 'Chrome is required for Staff Suppliers UI tests; set CHROME_PATH to override it')
  const sourceRoot = projectRoot.replaceAll('\\', '/')
  await writeFile(join(temporaryRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>')
  await writeFile(join(temporaryRoot, 'harness.jsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import StaffSuppliers from '/@fs/${sourceRoot}/src/pages/Staff/StaffSuppliers.jsx'
import '/@fs/${sourceRoot}/src/styles/variables.css'
import '/@fs/${sourceRoot}/src/styles/global.css'
import '/@fs/${sourceRoot}/src/styles/layouts/MainLayout.css'
import '/@fs/${sourceRoot}/src/styles/shared/Cards.css'
import '/@fs/${sourceRoot}/src/styles/shared/Tables.css'
import '/@fs/${sourceRoot}/src/styles/shared/Forms.css'
import '/@fs/${sourceRoot}/src/styles/shared/Shared.css'
import '/@fs/${sourceRoot}/src/styles/shared/Modal.css'
import '/@fs/${sourceRoot}/src/styles/shared/PageSkeleton.css'

globalThis.emptySupplierMode = new URLSearchParams(location.search).has('empty')
globalThis.multipleSupplierMode = new URLSearchParams(location.search).has('multiple')
globalThis.supplierRequestCount = 0
globalThis.failFirstSupplierRequest = !globalThis.emptySupplierMode && !globalThis.multipleSupplierMode
const northSupplier =
  { supplier_id: 5, supplier_name: 'North Poultry', contact_person: 'Jamie Santos', contact_number: '+63 912 555 0100', address: 'Quezon City warehouse' }
const islandSupplier =
  { supplier_id: 8, supplier_name: 'Island Foods', contact_person: 'Taylor Reyes', contact_number: '02-8123-4567', address: 'Cebu cold storage' }
globalThis.staffSupplierFixtures = globalThis.emptySupplierMode ? [] : globalThis.multipleSupplierMode ? [northSupplier, islandSupplier] : [northSupplier]
globalThis.staffStockInFixtures = [
  { stockin_id: 1, supplier_id: 5, product_name: 'Whole Chicken', unit: 'kg', quantity_received: '20.000', delivery_date: '2026-06-30T23:30:00+08:00' },
  { stockin_id: 2, supplier_id: 5, product_name: 'Chicken Wings', unit: 'kg', quantity_received: '40.000', delivery_date: '2026-07-01T00:05:00+08:00' },
  { stockin_id: 3, supplier_id: 5, product_name: 'Chicken Feet', unit: 'piece', quantity_received: '80.000', delivery_date: '2026-05-15T10:00:00+08:00' },
  { stockin_id: 4, supplier_id: 5, product_name: 'Chicken Liver', unit: 'kg', quantity_received: '35.500', delivery_date: '2026-09-15T11:00:00+08:00' },
  { stockin_id: 5, supplier_id: 5, product_name: 'Chicken Gizzard', unit: 'piece', quantity_received: '60.000', delivery_date: '2026-10-20T09:00:00+08:00' },
  { stockin_id: 6, supplier_id: 5, product_name: 'Whole Chicken', unit: 'kg', quantity_received: '55.000', delivery_date: '2026-11-22T23:50:00+08:00' },
  { stockin_id: 7, supplier_id: 5, product_name: 'Chicken Wings', unit: 'kg', quantity_received: '22.000', delivery_date: '2026-05-31T22:00:00+08:00' },
  { stockin_id: 8, supplier_id: 9, product_name: 'Frozen Chicken', unit: 'kg', quantity_received: '100.000', delivery_date: '2026-11-22T12:00:00+08:00' },
]
globalThis.fetch = async (input, options = {}) => {
  const path = new URL(String(input), location.origin).pathname
  if (path.endsWith('/suppliers') && (!options.method || options.method === 'GET')) {
    globalThis.supplierRequestCount += 1
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 220))
    if (globalThis.failFirstSupplierRequest) {
      globalThis.failFirstSupplierRequest = false
      return Response.json({ success: false, message: 'Mock directory request failed' }, { status: 503 })
    }
    return Response.json({ success: true, data: globalThis.staffSupplierFixtures })
  }
  if (path.endsWith('/stock-in') && (!options.method || options.method === 'GET')) {
    return Response.json({ success: true, data: globalThis.staffStockInFixtures })
  }
  return Response.json({ success: false, message: 'Unexpected mocked request: ' + path }, { status: 404 })
}
createRoot(document.getElementById('root')).render(<StaffSuppliers />)
`)

  vite = await createServer({
    root: temporaryRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: [
      { find: /^react$/, replacement: join(projectRoot, 'node_modules/react/index.js') },
      { find: /^react-dom\/client$/, replacement: join(projectRoot, 'node_modules/react-dom/client.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: join(projectRoot, 'node_modules/react/jsx-dev-runtime.js') },
      { find: /^react\/jsx-runtime$/, replacement: join(projectRoot, 'node_modules/react/jsx-runtime.js') },
    ] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [projectRoot, temporaryRoot] } },
    logLevel: 'error',
  })
  await vite.listen()
  const pageUrl = `http://127.0.0.1:${vite.httpServer.address().port}/`
  browserSession = await startBrowser({ browserPath, temporaryRoot, pageUrl })
  await browserSession.connect()
  console.log(`[BROWSER] ${browserSession.version.Browser}; DevTools connected`)
  const browser = browserSession.connection
  await browser.command('Runtime.enable')
  await browser.command('Page.enable')

  async function evaluate(expression) {
    let result
    try {
      result = await browser.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    } catch (error) {
      console.error(`[BROWSER EVALUATION FAILED] ${expression}`)
      throw error
    }
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  async function waitFor(expression, timeout = 10_000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(`Boolean(${expression})`)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for Staff Suppliers UI condition: ${expression}`)
  }

  await browser.command('Page.navigate', { url: pageUrl })
  await waitFor("Boolean(document.querySelector('#staff-supplier-monthly-title'))")
  assert(await evaluate("document.querySelectorAll('h1').length === 0 && document.body.textContent.includes('Monthly Delivery Activity')"), 'The removed Staff page header returned or the delivery section heading is missing')
  await waitFor("Boolean(document.querySelector('.staff-suppliers-profile-section .staff-suppliers-error'))")
  assert(await evaluate("document.body.textContent.includes('Mock directory request failed')"), 'Supplier load error was not displayed')
  await evaluate("document.querySelector('.staff-suppliers-profile-section .staff-suppliers-error button').click()")
  await waitFor("document.querySelector('.staff-supplier-profile h2')?.textContent === 'North Poultry'")
  assert(await evaluate("document.querySelectorAll('.staff-supplier-profile-fields dt').length === 3 && !document.querySelector('.staff-supplier-profile form')"), 'Supplier profile did not show permitted contact fields without mutation controls')
  assert(await evaluate("!document.querySelector('.staff-supplier-profile select')"), 'Single-supplier profile displayed an unnecessary supplier selector')
  assert(await evaluate("document.querySelectorAll('.staff-supplier-metric-card')[0].querySelector('strong')?.textContent === '7'"), 'Delivery total did not count the selected supplier Stock-In records')
  assert(await evaluate("document.querySelectorAll('.staff-supplier-metric-card')[1].textContent.includes('Nov 22, 2026')"), 'Last delivery date was not formatted from the latest receipt')
  await waitFor("document.querySelectorAll('.staff-supplier-chart-column').length === 6")
  assert(await evaluate("document.querySelectorAll('.staff-supplier-chart-column').length === 6 && document.querySelector('.staff-supplier-chart-column[aria-label^=\"June 2026, 1 delivery\"]') && [...document.querySelectorAll('.staff-supplier-chart-column')].some((column) => column.querySelector('.staff-supplier-chart-zero')?.textContent === '0' && !column.querySelector('.staff-supplier-chart-bar'))"), 'Six-month chart did not show zero-filled Manila calendar buckets correctly')
  assert(await evaluate("[...document.querySelectorAll('.staff-supplier-chart-y-axis > span')].every((tick) => Number.isInteger(Number(tick.textContent))) && [...document.querySelectorAll('.staff-supplier-chart-column')].some((column) => column.querySelector('.staff-supplier-chart-zero')?.textContent === '0' && !column.querySelector('.staff-supplier-chart-bar'))"), 'Chart displayed fractional ticks or a visible bar for a zero month')
  assert(await evaluate("document.querySelector('.staff-supplier-chart-column[data-tooltip*=" + JSON.stringify('1 delivery') + "]')?.getAttribute('aria-label').includes('1 delivery')"), 'Chart labels or keyboard tooltip text used incorrect delivery grammar')
  assert(await evaluate("document.querySelectorAll('.staff-supplier-recent-table-wrap .system-data-table tbody tr').length === 5"), 'Recent deliveries did not show the five newest records')
  assert(await evaluate("[...document.querySelectorAll('.staff-supplier-recent-table-wrap .system-data-table thead th')].map((th) => th.textContent.trim()).join('|') === 'Delivery reference|Delivery date|Product|Quantity received'"), 'Recent deliveries did not preserve the four required columns')
  assert(await evaluate("Boolean(document.querySelector('.staff-supplier-recent-table-wrap .system-data-table tbody tr td:first-child')?.textContent.trim() === 'DLV-6' && document.querySelector('.staff-supplier-recent-table-wrap .system-data-table time span') && document.querySelector('.staff-supplier-recent-table-wrap .system-data-table time small'))"), 'Reference or separate date and time was missing')
  assert(await evaluate("document.querySelector('.staff-supplier-recent-table-wrap .system-data-table tbody tr td:nth-child(4)')?.textContent.includes('kg') && document.querySelector('.staff-supplier-recent-table-wrap .system-data-table tbody tr td:nth-child(4)')?.textContent.includes('55')"), 'Quantity formatting or configured unit was not retained')
  assert(await evaluate("!document.body.textContent.includes('Total Cost') && !document.body.textContent.includes('Cost Per Unit') && !document.body.textContent.includes('Total Spend')"), 'Supplier page displayed procurement cost information')
  assert(await evaluate("!['Add Supplier', 'Edit Supplier', 'Archive Supplier', 'Restore Supplier'].some((text) => document.body.textContent.includes(text))"), 'Staff supplier page displayed a mutation action')
  assert(await evaluate("!document.body.textContent.includes('Read Only') && ![...document.querySelectorAll('a')].some((link) => link.textContent.includes('Open Inventory & Stock-In'))"), 'Removed Staff-only read-only label or inventory link returned')
  console.log('PASS loading/error retry, supplier profile, selection, delivery summaries, chart, recent rows, and read-only projection')

  await evaluate("(() => { const input = document.querySelector('.staff-suppliers-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Wings'); input.dispatchEvent(new Event('input', { bubbles: true })); })()")
  await waitFor("document.querySelectorAll('.staff-supplier-recent-table-wrap .system-data-table tbody tr').length === 1")
  assert(await evaluate("document.querySelector('.staff-supplier-recent-table-wrap .system-data-table tbody').textContent.includes('DLV-2')"), 'Recent delivery search did not match product records')
  await evaluate("(() => { const input = document.querySelector('.staff-suppliers-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'dlv-2'); input.dispatchEvent(new Event('input', { bubbles: true })); })()")
  await waitFor("document.querySelectorAll('.staff-supplier-recent-table-wrap .system-data-table tbody tr').length === 1")
  await evaluate("document.querySelector('.staff-supplier-search-clear').click()")
  await waitFor("document.querySelectorAll('.staff-supplier-recent-table-wrap .system-data-table tbody tr').length === 5")
  await evaluate("(() => { const input = document.querySelector('.staff-suppliers-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'no such delivery'); input.dispatchEvent(new Event('input', { bubbles: true })); })()")
  await waitFor("document.body.textContent.includes('No recent deliveries match your search')")
  assert(await evaluate("!document.querySelector('.staff-supplier-recent-table-wrap .system-data-table')"), 'No-results search state retained stale delivery rows')
  await evaluate("document.querySelector('.staff-supplier-search-clear').click()")
  await waitFor("document.querySelectorAll('.staff-supplier-recent-table-wrap .system-data-table tbody tr').length === 5")
  console.log('PASS recent product/reference search, clear action, no-results state, and result reset')

  await browser.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }).then((image) => writeFile(join(screenshotRoot, 'staff-suppliers-desktop.png'), image.data, 'base64'))

  await browser.command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
  await waitFor("Boolean(document.querySelector('.staff-supplier-recent-table-wrap .system-data-table tbody tr'))")
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Staff Suppliers page overflowed the 375px viewport')
  assert(await evaluate("getComputedStyle(document.querySelector('.staff-supplier-recent-table-wrap .system-data-table thead')).position === 'absolute'"), 'Recent delivery table did not switch to its mobile layout')
  await browser.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }).then((image) => writeFile(join(screenshotRoot, 'staff-suppliers-mobile.png'), image.data, 'base64'))
  console.log('PASS mobile layout without horizontal page overflow')

  await browser.command('Page.navigate', { url: `${pageUrl}?multiple=1` })
  await waitFor("document.querySelector('.staff-supplier-profile select')?.options.length === 2")
  await evaluate("(() => { const select = document.querySelector('.staff-supplier-profile select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '8'); select.dispatchEvent(new Event('change', { bubbles: true })); })()")
  await waitFor("document.querySelector('.staff-supplier-profile h2')?.textContent === 'Island Foods'")
  assert(await evaluate("document.querySelectorAll('.staff-supplier-metric-card')[0].querySelector('strong')?.textContent === '0' && document.body.textContent.includes('No deliveries recorded.')"), 'Supplier without deliveries did not show the empty summary')
  assert(await evaluate("document.body.textContent.includes('No delivery activity recorded for the last six months') && !document.querySelector('.staff-supplier-chart')"), 'Zero-activity chart did not use its dedicated empty state')
  console.log('PASS future multiple-supplier selection and supplier-specific empty delivery state')

  await browser.command('Page.navigate', { url: `${pageUrl}?empty=1` })
  await waitFor("Boolean(document.querySelector('.staff-suppliers-empty-profile'))")
  assert(await evaluate("document.body.textContent.includes('No active supplier is registered yet') && document.body.textContent.includes('No active supplier is available for delivery activity')"), 'No-active-supplier state was not displayed safely')
  console.log(`STAFF_SUPPLIERS_SCREENSHOTS ${screenshotRoot}`)
} catch (error) {
  if (browserSession) reportBrowserDiagnostics(browserSession)
  throw error
} finally {
  await cleanupBrowserSession(browserSession)
  await closeViteServer(vite)
  await removeTemporaryRoot(temporaryRoot, tmpdir())
  console.log(`ASSERTIONS passed=${assertions.counts.passed} failed=${assertions.counts.failed}`)
}
