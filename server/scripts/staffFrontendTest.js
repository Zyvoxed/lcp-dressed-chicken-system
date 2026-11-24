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
const screenshotRoot = await createScreenshotRunDirectory(projectRoot, 'staff-ui')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lcp-staff-ui-'))
const safeTempRoot = `${resolve(tmpdir())}${sep}`
const browserPath = findBrowser()
let browserSession
let vite
const browserConsoleEvents = []

try {
  assert(resolve(temporaryRoot).startsWith(safeTempRoot), 'Unsafe temporary Staff UI directory')
  assert(browserPath, 'Chrome is required for Staff UI tests; set CHROME_PATH to override it')
  const sourceRoot = projectRoot.replaceAll('\\', '/')
  await writeFile(join(temporaryRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>')
  await writeFile(join(temporaryRoot, 'harness.jsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from '/@fs/${sourceRoot}/src/App.jsx'
import '/@fs/${sourceRoot}/src/styles/variables.css'
import '/@fs/${sourceRoot}/src/styles/global.css'
import '/@fs/${sourceRoot}/src/styles/layouts/MainLayout.css'
import '/@fs/${sourceRoot}/src/styles/layouts/Sidebar.css'
import '/@fs/${sourceRoot}/src/styles/layouts/Header.css'
import '/@fs/${sourceRoot}/src/styles/shared/Cards.css'
import '/@fs/${sourceRoot}/src/styles/shared/Tables.css'
import '/@fs/${sourceRoot}/src/styles/shared/Forms.css'
import '/@fs/${sourceRoot}/src/styles/shared/Shared.css'
import '/@fs/${sourceRoot}/src/styles/shared/Modal.css'
import '/@fs/${sourceRoot}/src/styles/shared/PageSkeleton.css'
import '/@fs/${sourceRoot}/src/styles/pages/Dashboard.css'
import '/@fs/${sourceRoot}/src/styles/pages/RecordSales.css'
import '/@fs/${sourceRoot}/src/styles/pages/Inventory.css'
import '/@fs/${sourceRoot}/src/styles/pages/CustomerCredits.css'
import '/@fs/${sourceRoot}/src/styles/pages/SupplierContracts.css'
import '/@fs/${sourceRoot}/src/styles/pages/Reports.css'
import '/@fs/${sourceRoot}/src/styles/responsive.css'

localStorage.setItem('authToken', 'staff-ui-test-token')
const dashboard = {
  summary: { today_transactions: 3, outstanding_credits: '90.00' },
  recent_transactions: [{ transaction_type: 'Sale', reference_id: 51, customer_name: 'POS Customer', status: 'Paid', occurred_at: '2026-11-22T10:00:00+08:00' }],
  today_quantity_by_unit: [{ unit: 'kg', total_quantity: '2.000' }, { unit: 'piece', total_quantity: '3.000' }],
  low_stock_alerts: [{ product_id: 4, product_name: 'POS Product', unit: 'kg', stock_quantity: '1.000', reorder_level: '2.000', status: 'Low Stock' }],
  recent_stock_in: [{ stockin_id: 12, supplier_name: 'Active Supplier', product_name: 'POS Product', unit: 'kg', quantity_received: '3.000', delivery_date: '2026-11-22T09:00:00+08:00' }],
}
const products = [{ product_id: 4, product_name: 'POS Product', category: 'Whole Chicken', unit: 'kg', selling_price: '250.00', stock_quantity: '5.000' }]
const inventory = [{ product_id: 4, product_name: 'POS Product', category: 'Whole Chicken', unit: 'kg', stock_quantity: '5.000', reorder_level: '1.000', status: 'Available' }]
const suppliers = [{ supplier_id: 5, supplier_name: 'Active Supplier', contact_person: 'Contact', contact_number: '555-0100', address: 'Test address' }]
const customers = [{ customer_id: 17, customer_name: 'POS Customer', current_balance: '90.00' }]
const credits = [{ sale_id: 52, sale_date: '2026-11-20T10:00:00+08:00', total_amount: '100.00', amount_paid: '10.00', remaining_balance: '90.00', status: 'Partially Paid', recorded_by: 'Staff Test' }]
const payments = [{ payment_id: 73, sale_id: 52, payment_amount: '10.00', remaining_balance: '90.00', payment_date: '2026-11-20T11:00:00+08:00', recorded_by: 'Staff Test' }]
const cashSales = [{ sale_id: 50, sale_date: '2026-11-19T10:00:00+08:00', amount_paid: '45.00', payment_type: 'Cash', status: 'Paid' }]
globalThis.staffReportMode = 'success'
globalThis.staffReportRequests = []
globalThis.staffCreditMode = 'success'
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input), location.origin)
  const path = url.pathname
  const json = (data, status = 200) => Response.json({ success: true, ...data }, { status })
  if (path.endsWith('/auth/me')) return json({ user: { user_id: 41, fullname: 'Staff Test', role: 'Staff' } })
  if (path.endsWith('/analytics/dashboard')) return json({ data: dashboard })
  if (path.endsWith('/analytics/dashboard/sales-activity')) return json({ data: { days: [
    { date: '2026-11-17', transactions: 0 },
    { date: '2026-11-18', transactions: 2 },
    { date: '2026-11-19', transactions: 1 },
    { date: '2026-11-20', transactions: 0 },
    { date: '2026-11-21', transactions: 0 },
    { date: '2026-11-22', transactions: 3 },
    { date: '2026-11-23', transactions: 0 },
  ] } })
  if (path.endsWith('/products/inventory')) return json({ data: inventory })
  if (path.endsWith('/products')) return json({ data: products })
  if (path.endsWith('/suppliers')) return json({ data: suppliers })
  if (path.endsWith('/customers/17/credits')) {
    if (globalThis.staffCreditMode === 'error') return Response.json({ success: false, message: 'Mock credit details failed' }, { status: 503 })
    return json({ data: credits })
  }
  if (path.endsWith('/customers/17/payments')) {
    if (globalThis.staffCreditMode === 'error') return Response.json({ success: false, message: 'Mock payment history failed' }, { status: 503 })
    return json({ data: payments })
  }
  if (path.endsWith('/customers/17/cash-sales')) return json({ data: cashSales })
  if (path.endsWith('/customers/17')) return json({ data: customers[0] })
  if (path.endsWith('/customers')) return json({ data: customers })
  if (path.endsWith('/stock-in')) return json({ data: [{ stockin_id: 12, supplier_id: 5, supplier_name: 'Active Supplier', product_id: 4, product_name: 'POS Product', unit: 'kg', quantity_received: '3.000', remaining_quantity: '2.000', delivery_date: '2026-11-22T09:00:00+08:00', recorded_by: 'Staff Test' }] })
  if (path.includes('/reports/operational/')) {
    const pathParts = path.split('/operational/')[1].split('/')
    const report = pathParts[0]
    const isExport = pathParts[1] === 'export'
    const search = url.searchParams.get('search') || ''
    globalThis.staffReportRequests.push({ report, isExport, query: Object.fromEntries(url.searchParams) })
    if (globalThis.staffReportMode === 'error') return Response.json({ success: false, message: 'Mock report request failed' }, { status: 503 })
    const fixtures = {
      sales: {
        summary: { transaction_count: 1, quantity_by_unit: [{ unit: 'kg', total_quantity: '2.000' }] },
        records: [{ sale_id: 51, sale_date: '2026-11-22T10:00:00+08:00', customer_name: 'POS Customer', payment_type: 'Cash', status: 'Paid', item_count: 1, quantity_by_unit: [{ unit: 'kg', total_quantity: '2.000' }], products_sold: [{ product_name: 'POS Product', unit: 'kg', quantity_sold: '2.000' }] }],
      },
      inventory: {
        summary: { active_products: 1, low_stock_products: 0, out_of_stock_products: 0, quantity_by_unit: [{ unit: 'kg', total_quantity: '5.000' }] },
        records: [{ product_id: 4, product_name: 'POS Product', category: 'Whole Chicken', unit: 'kg', stock_quantity: '5.000', reorder_level: '1.000', status: 'Available' }],
      },
      'stock-in': {
        summary: null,
        records: [{ stockin_id: 12, delivery_date: '2026-11-22T09:00:00+08:00', supplier_name: 'Active Supplier', product_name: 'POS Product', quantity_received: '3.000', unit: 'kg' }],
      },
      receivables: {
        summary: { customers_with_balance: 1, total_receivables: '90.00' },
        records: [{ customer_id: 17, customer_name: 'POS Customer', current_balance: '90.00' }],
      },
    }
    const result = fixtures[report]
    const records = search === 'trigger-empty' ? [] : result.records
    const total = records.length
    return json({ data: { report, summary: result.summary, records, pagination: { page: Number(url.searchParams.get('page') || 1), page_size: Number(url.searchParams.get('page_size') || 25), total_records: total, total_pages: total ? 1 : 0 } } })
  }
  if (path.includes('/idempotency/')) return json({ data: { state: 'not_found' } })
  return Response.json({ success: false, message: 'Unexpected mocked Staff request: ' + path }, { status: 404 })
}
createRoot(document.getElementById('root')).render(<App />)
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
  console.log(`[BROWSER] ${browserSession.version.Browser}; process started, DevTools discovered, WebSocket connected`)
  const browser = browserSession.connection
  browser.socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') browserConsoleEvents.push({ method: message.method, params: message.params })
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) browserConsoleEvents.push({
        method: message.method,
        type: message.params.type,
        args: message.params.args?.map((argument) => argument.value ?? argument.description),
        stackTrace: message.params.stackTrace,
      })
      if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) browserConsoleEvents.push({ method: message.method, entry: message.params.entry })
    } catch (error) {
      browserConsoleEvents.push({ method: 'devtools-message-parse-error', message: error.message })
    }
  })
  await browser.command('Runtime.enable')
  await browser.command('Log.enable')
  await browser.command('Page.enable')

  async function evaluate(expression) {
    const result = await browser.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      throw new Error(JSON.stringify({
        expression,
        text: details.text,
        description: details.exception?.description,
        stackTrace: details.stackTrace,
      }))
    }
    return result.result.value
  }
  async function waitFor(expression, timeout = 10000) {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(`Boolean(${expression})`)) return
      await delay(100)
    }
    throw new Error(`Timed out waiting for Staff UI condition: ${expression}`)
  }
  async function waitForStaffDashboard(timeout = 10000) {
    const started = Date.now()
    let stableSamples = 0
    let state
    while (Date.now() - started < timeout) {
      state = await evaluate(`(() => {
        const dashboards = [...document.querySelectorAll('.staff-dashboard')].filter((node) => node.isConnected)
        const dashboard = dashboards.at(-1)
        return {
          pathname: location.pathname,
          dashboardCount: dashboards.length,
          dashboardText: dashboard?.textContent || '',
          adminAnalyticsRendered: Boolean(document.querySelector('.business-analytics-page')),
        }
      })()`)
      const ready = state.pathname === '/dashboard'
        && state.dashboardText.includes('Sales transactions today')
        && !state.adminAnalyticsRendered
      stableSamples = ready ? stableSamples + 1 : 0
      if (stableSamples >= 3) return state
      await delay(100)
    }
    throw new Error(`Staff Dashboard did not reach a stable loaded state: ${JSON.stringify(state)}`)
  }
  async function clickByText(text) {
    await evaluate(`(() => { const button = [...document.querySelectorAll('#primary-sidebar button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Missing navigation: ' + ${JSON.stringify(text)}); button.click() })()`)
  }

  await browser.command('Page.navigate', { url: pageUrl })
  await waitFor("Boolean(document.querySelector('#primary-sidebar button') && document.querySelector('.staff-dashboard'))")
  const staffNav = await evaluate("[...document.querySelectorAll('#primary-sidebar button')].map((button) => button.textContent.trim())")
  assert(JSON.stringify(staffNav) === JSON.stringify(['Dashboard', 'Point of Sale', 'Inventory & Stock In', 'Customer Credits', 'Suppliers', 'Reports & Audits']), 'Staff navigation did not match the six-module allowlist')
  assert(!staffNav.some((label) => ['Business Analytics', 'User Accounts', 'Activity Logs'].includes(label)), 'An Admin-only module appeared in the Staff sidebar')
  await waitFor("document.querySelectorAll('.staff-sales-activity-point').length === 7")
  assert(await evaluate("document.querySelector('#staff-sales-activity-title').textContent.trim() === 'Sales Activity' && document.querySelectorAll('.staff-sales-activity-point').length === 7"), 'Staff dashboard sales activity did not render seven daily data points')
  assert(await evaluate("document.querySelector('.staff-sales-activity-chart').getAttribute('aria-label').includes('2 transactions') && !document.querySelector('.staff-sales-activity-chart').getAttribute('aria-label').includes('₱')"), 'Sales activity omitted transaction counts or exposed financial data')
  assert(await evaluate("Boolean(document.querySelector('.staff-sales-activity-panel').compareDocumentPosition(document.querySelector('.staff-low-stock-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)"), 'Sales activity was not placed above Low-Stock Items')
  assert(await evaluate("document.body.textContent.includes('2 kg · 3 piece') && !document.body.textContent.includes('Total revenue')"), 'Staff dashboard mixed units or exposed an Admin financial summary')
  await browser.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }).then((image) => writeFile(join(screenshotRoot, 'staff-dashboard.png'), image.data, 'base64'))

  await clickByText('Inventory & Stock In')
  await waitFor("document.body.textContent.includes('PRODUCTS AND STOCK')")
  assert(await evaluate("document.body.textContent.includes('5') && !document.body.textContent.includes('Add Product') && !document.body.textContent.includes('Archived Products')"), 'Staff inventory did not stay read-only or show configured units')

  await evaluate("(() => { const tab = [...document.querySelectorAll('.inventory-nav-tab')].find((el) => el.textContent.includes('Stock In Product')); if (!tab) throw new Error('Missing Stock In tab'); tab.click(); })()")
  await waitFor("Boolean(document.querySelector('form'))")
  assert(await evaluate("document.body.textContent.includes('Active Supplier') && document.body.textContent.includes('POS Product')"), 'Staff Stock-In did not load active supplier and product options')

  await evaluate("(() => { const tab = [...document.querySelectorAll('.inventory-nav-tab')].find((el) => el.textContent.includes('Inflow Records')); if (!tab) throw new Error('Missing Inflow Records tab'); tab.click(); })()")
  await waitFor("document.body.textContent.includes('STOCK DELIVERY HISTORY')")
  assert(await evaluate("!document.body.textContent.includes('Cost Per Unit') && !document.body.textContent.includes('Total Cost')"), 'Staff Inflow Records exposed cost fields')

  await clickByText('Suppliers')
  await waitFor("Boolean(document.querySelector('.staff-supplier-profile'))")
  assert(await evaluate("document.body.textContent.includes('Active Supplier') && !document.body.textContent.includes('Add Supplier') && !document.body.textContent.includes('Archived Suppliers')"), 'Staff supplier view exposed management actions')

  await clickByText('Customer Credits')
  await waitFor("document.querySelector('.customer-selection-row')")
  await evaluate("document.querySelector('.customer-selection-row').click()")
  await waitFor("document.body.textContent.includes('Payment History')")
  assert(await evaluate("document.body.textContent.includes('90.00') && document.body.textContent.includes('Record Payment') && !document.body.textContent.includes('Sales History')"), 'Staff customer credit view did not show balances/payment workflow safely')

  await clickByText('Reports & Audits')
  await waitFor("document.querySelector('.staff-reports [role=tab]')?.textContent.includes('Sales Activity Audit') && document.querySelector('.staff-reports tbody')?.textContent.includes('POS Customer')")
  const reportsAudit = await evaluate("(() => ({ tabs: document.querySelectorAll('.staff-reports > .reports-tabs-container [role=tab]').length, apply: document.body.textContent.includes('Apply Filters'), export: document.body.textContent.includes('Export CSV'), profit: document.body.textContent.includes('Profit'), salesRevenue: document.body.textContent.includes('Sales & Revenue Audit'), inventoryAssets: document.body.textContent.includes('Inventory Assets Valuation'), stockInActivity: document.body.textContent.includes('Stock-In Activity') }))()")
  assert(reportsAudit.tabs === 3 && reportsAudit.apply && reportsAudit.export && !reportsAudit.profit && !reportsAudit.salesRevenue && !reportsAudit.inventoryAssets && !reportsAudit.stockInActivity, 'Staff did not render the three-tab Reports UI with restricted labels and data')
  assert(await evaluate("document.querySelector('.staff-reports tbody').textContent.includes('POS Customer')"), 'Staff operational sales report did not render its data')
  assert(await evaluate("document.querySelectorAll('.staff-reports input[type=date]').length === 2 && [...document.querySelectorAll('.staff-reports select')].some((select) => select.options.length === 3) && document.querySelector('.staff-reports tbody').textContent.includes('POS Product')"), 'Sales date, method, status filters, or product detail were missing')
  await evaluate("[...document.querySelectorAll('.staff-reports > .reports-tabs-container [role=tab]')].find((tab) => tab.textContent.includes('Inventory Status')).click()")
  await waitFor("document.querySelector('.staff-reports tbody')?.textContent.includes('POS Product')")
  assert(await evaluate("!document.querySelector('.staff-reports input[type=date]') && !document.body.textContent.includes('selling_price') && document.body.textContent.includes('Inventory Status') && !document.body.textContent.includes('Stock-In Activity')"), 'Inventory report showed unsupported filters or an extra Stock-In report tab')
  await evaluate("[...document.querySelectorAll('.staff-reports > .reports-tabs-container [role=tab]')].find((tab) => tab.textContent.includes('Customer Receivables Ledger')).click()")
  await waitFor("document.querySelector('.staff-reports tbody')?.textContent.includes('POS Customer')")
  assert(await evaluate("document.querySelector('.staff-reports tbody').textContent.includes('90.00') && document.body.textContent.includes('Outstanding Balances')"), 'Customer balance report did not render the permitted outstanding balance')
  await evaluate("(() => { const input = document.querySelector('.staff-reports input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'POS'); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.staff-reports form').requestSubmit(); })()")
  await waitFor("document.querySelector('.staff-reports tbody')?.textContent.includes('POS Customer')")
  await evaluate("globalThis.staffCreditMode = 'error'; document.querySelector('.staff-reports tbody button').focus(); document.querySelector('.staff-reports tbody button').click()")
  await waitFor("document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"] [role=alert]')?.textContent.includes('Mock credit details failed') || document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"] [role=alert]')?.textContent.includes('Mock payment history failed')")
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')?.textContent.includes('Try Again')"), 'Credit details error state did not offer a retry')
  await evaluate("globalThis.staffCreditMode = 'success'; document.querySelector('[role=dialog] .staff-credit-modal-error button').click()")
  await waitFor("document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')?.textContent.includes('Customer Credit Ledger')")
  await evaluate("[...document.querySelectorAll('[role=dialog] [role=tab]')].find((tab) => tab.textContent.includes('Payment History')).click()")
  await waitFor("document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')?.textContent.includes('PAY-73')")
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')?.textContent.includes('Cash · Paid') && document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')?.textContent.includes('OR-50')"), 'Staff payment history did not include the customer cash sale')
  assert(await evaluate("(() => { const dialog = document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]'); const buttons = [...dialog.querySelectorAll('button')].map((button) => button.textContent.trim()); return dialog.textContent.includes('POS Customer') && dialog.textContent.includes('OR-52') && dialog.textContent.includes('PAY-73') && dialog.textContent.includes('Outstanding Balance') && !buttons.some((text) => /record payment|edit credit|delete|reverse|adjustment/i.test(text)); })()"), 'Customer credit modal omitted authorized details or exposed a modification action')
  const reportPath = await evaluate('location.pathname')
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await waitFor("!document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')")
  assert(await evaluate("location.pathname === " + JSON.stringify(reportPath) + " && document.querySelector('.staff-reports input[type=search]')?.value === 'POS' && document.querySelector('.staff-reports > .reports-tabs-container [aria-selected=true]')?.textContent.includes('Customer Receivables Ledger') && document.activeElement?.getAttribute('aria-label') === 'View Credits for POS Customer'"), 'Closing the credits modal changed the report state or failed to restore focus')
  await evaluate("document.querySelector('.staff-reports tbody button').focus(); document.querySelector('.staff-reports tbody button').click()")
  await waitFor("document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')")
  await evaluate("document.querySelector('[role=dialog] .close-button').click()")
  await waitFor("!document.querySelector('[role=dialog][aria-label=\"Customer Credit Ledger\"]')")
  await evaluate("[...document.querySelectorAll('.staff-reports > .reports-tabs-container [role=tab]')].find((tab) => tab.textContent.includes('Sales Activity Audit')).click()")
  await waitFor("document.querySelector('.staff-reports tbody')?.textContent.includes('POS Customer')")
  await evaluate("(() => { globalThis.staffReportMode = 'error'; const input = document.querySelector('.staff-reports input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'trigger-error'); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.staff-reports form').requestSubmit(); })()")
  await waitFor("document.querySelector('.report-inline-error')?.textContent.includes('Mock report request failed')")
  await evaluate("globalThis.staffReportMode = 'success'; document.querySelector('.report-inline-error button').click()")
  await waitFor("document.querySelector('.staff-reports tbody')?.textContent.includes('POS Customer')")
  await evaluate("(() => { const input = document.querySelector('.staff-reports input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'trigger-empty'); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.staff-reports form').requestSubmit(); })()")
  await waitFor("document.body.textContent.includes('No records match the selected filters or search.')")
  await evaluate("document.querySelector('.staff-reports form button[type=button]').click()")
  await waitFor("document.querySelector('.staff-reports tbody')?.textContent.includes('POS Customer')")
  await evaluate("document.querySelector('.staff-reports .report-filter-actions button:nth-child(3)').click()")
  await waitFor("globalThis.staffReportRequests.some((request) => request.report === 'sales' && request.isExport)")
  assert(await evaluate("!document.querySelector('.staff-reports tbody').textContent.includes('Total Amount') && !document.querySelector('.staff-reports tbody').textContent.includes('Profit')"), 'Sales operational report or export workflow exposed financial performance fields')

  await browser.command('Page.navigate', { url: `${pageUrl}business-analytics` })
  const restrictedNavigation = await waitForStaffDashboard()
  assert(restrictedNavigation.pathname === '/dashboard' && restrictedNavigation.dashboardText.includes('Sales transactions today') && !restrictedNavigation.adminAnalyticsRendered, `Direct navigation to Admin analytics did not return Staff to the fully loaded operational dashboard: ${JSON.stringify(restrictedNavigation)}`)

  await browser.command('Page.navigate', { url: `${pageUrl}dashboard` })
  const directDashboard = await waitForStaffDashboard()
  assert(directDashboard.pathname === '/dashboard' && directDashboard.dashboardText.includes('Sales transactions today') && !directDashboard.adminAnalyticsRendered, `Direct Staff Dashboard navigation did not load the operational dashboard: ${JSON.stringify(directDashboard)}`)

  await browser.command('Page.reload', { ignoreCache: true })
  const refreshedDashboard = await waitForStaffDashboard()
  assert(refreshedDashboard.pathname === '/dashboard' && refreshedDashboard.dashboardText.includes('Sales transactions today') && !refreshedDashboard.adminAnalyticsRendered, `Refreshing the Staff Dashboard did not restore the authorized operational dashboard: ${JSON.stringify(refreshedDashboard)}`)
  console.log('PASS Staff seven-module navigation and Admin-only link exclusion')
  console.log('PASS operational dashboard, read-only inventory, Stock-In options, suppliers, customer credits, and operational reports')
  console.log('PASS restricted URL redirects to Staff, direct dashboard navigation, and dashboard refresh')
  console.log(`STAFF_SCREENSHOTS ${screenshotRoot}`)
} catch (error) {
  if (browserSession?.connection?.socket.readyState === WebSocket.OPEN) {
    try {
      const snapshot = await browserSession.connection.command('Runtime.evaluate', {
        expression: `JSON.stringify({ href: location.href, pathname: location.pathname, title: document.title, readyState: document.readyState, bodyText: document.body?.innerText?.slice(0, 4000), staffDashboards: [...document.querySelectorAll('.staff-dashboard')].map((node) => ({ text: node.innerText.slice(0, 500), connected: node.isConnected, rect: (() => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })(), opacity: getComputedStyle(node).opacity, parent: node.parentElement?.outerHTML.slice(0, 700) })) })`,
        returnByValue: true,
      })
      console.error(`BROWSER_FAILURE_STATE ${snapshot.result?.value || snapshot.exceptionDetails?.text || 'unavailable'}`)
    } catch (snapshotError) {
      console.error(`BROWSER_FAILURE_STATE_CAPTURE_ERROR ${snapshotError.stack || snapshotError.message}`)
    }
  }
  console.error(`BROWSER_CONSOLE_EVENTS ${JSON.stringify(browserConsoleEvents)}`)
  reportBrowserDiagnostics(browserSession)
  throw error
} finally {
  console.log(`ASSERTIONS passed=${assertions.counts.passed} failed=${assertions.counts.failed}`)
  const cleanupErrors = []
  try { console.log(`BROWSER_SHUTDOWN ${await cleanupBrowserSession(browserSession)}`) } catch (error) { cleanupErrors.push(error) }
  let viteStopped = !vite
  try { console.log(`VITE_SHUTDOWN ${await closeViteServer(vite)}`); viteStopped = true } catch (error) { cleanupErrors.push(error) }
  const browserStopped = !browserSession || browserSession.process.exitCode !== null || browserSession.process.signalCode !== null
  if (browserStopped && viteStopped) {
    try { await removeTemporaryRoot(temporaryRoot, safeTempRoot) } catch (error) { cleanupErrors.push(error) }
  } else cleanupErrors.push(new Error(`Preserved temporary root because browser/Vite shutdown was not confirmed: ${temporaryRoot}`))
  if (cleanupErrors.length) {
    for (const error of cleanupErrors) console.error(`CLEANUP_ERROR ${error.stack || error.message}`)
    process.exitCode = 1
  }
}
