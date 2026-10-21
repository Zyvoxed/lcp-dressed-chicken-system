import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForDebugger(port, pageUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const pages = await response.json()
      const page = pages.find((candidate) => candidate.url.startsWith(pageUrl))
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // The browser is still starting.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for the reports browser test')
}

function connectToBrowser(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  let commandId = 0

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolveCommand, rejectCommand } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) rejectCommand(new Error(message.error.message))
    else resolveCommand(message.result)
  })

  const ready = new Promise((resolveReady, rejectReady) => {
    socket.addEventListener('open', resolveReady, { once: true })
    socket.addEventListener('error', rejectReady, { once: true })
  })

  return {
    socket,
    ready,
    command(method, params = {}) {
      commandId += 1
      socket.send(JSON.stringify({ id: commandId, method, params }))
      return new Promise((resolveCommand, rejectCommand) => pending.set(commandId, { resolveCommand, rejectCommand }))
    },
  }
}

function findChrome() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean).find((candidate) => existsSync(candidate))
}

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const screenshotRoot = join(projectRoot, 'test-results', 'reports-phase7')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lcp-reports-ui-'))
const safeTempRoot = `${resolve(tmpdir())}${sep}`
const browserPort = await getFreePort()
const vitePort = await getFreePort()
const chromePath = findChrome()
let browser
let vite
let browserConnection

try {
  assert(resolve(temporaryRoot).startsWith(safeTempRoot), 'Unsafe temporary test directory')
  assert(chromePath, 'Chrome or Edge is required for the reports UI test')
  const sourceRoot = projectRoot.replaceAll('\\', '/')

  await writeFile(join(temporaryRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>')
  await writeFile(join(temporaryRoot, 'harness.jsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import Reports from '/@fs/${sourceRoot}/src/pages/Reports/Reports.jsx'
import '/@fs/${sourceRoot}/src/styles/variables.css'
import '/@fs/${sourceRoot}/src/styles/global.css'
import '/@fs/${sourceRoot}/src/styles/shared/Forms.css'
import '/@fs/${sourceRoot}/src/styles/shared/Cards.css'
import '/@fs/${sourceRoot}/src/styles/shared/Shared.css'
import '/@fs/${sourceRoot}/src/styles/shared/Tables.css'
import '/@fs/${sourceRoot}/src/styles/shared/Modal.css'
import '/@fs/${sourceRoot}/src/styles/layouts/MainLayout.css'
import '/@fs/${sourceRoot}/src/styles/pages/Reports.css'

document.documentElement.dataset.theme = 'light'
localStorage.setItem('authToken', 'reports-test-token')

const records = [
  { sale_id: 201, sale_date: '2026-10-21T09:15:00+08:00', customer_name: 'Walk-in Customer', recorded_by: 'Test Admin', payment_type: 'Cash', total_amount: '1250.00', amount_paid: '1250.00', remaining_balance: '0.00', status: 'Paid' },
  { sale_id: 202, sale_date: '2026-10-21T10:30:00+08:00', customer_name: 'Maria Santos', recorded_by: 'Test Admin', payment_type: 'Credit', total_amount: '2500.00', amount_paid: '500.00', remaining_balance: '2000.00', status: 'Partially Paid' },
  { sale_id: 203, sale_date: '2026-10-20T11:00:00+08:00', customer_name: 'Credit Customer', recorded_by: 'Test Admin', payment_type: 'Credit', total_amount: '900.00', amount_paid: '0.00', remaining_balance: '900.00', status: 'Unpaid' },
  ...Array.from({ length: 7 }, (_, index) => ({ sale_id: 204 + index, sale_date: '2026-10-19T08:00:00+08:00', customer_name: 'Fixture Customer ' + (index + 1), recorded_by: 'Test Admin', payment_type: 'Cash', total_amount: '100.00', amount_paid: '100.00', remaining_balance: '0.00', status: 'Paid' })),
]

const salesReport = { summary: { total_transactions: records.length, gross_sales: '5350.00', cash_sales_total: '1950.00', credit_sales_total: '3400.00', total_amount_paid: '2450.00', outstanding_balance: '2900.00' }, records }
const details = { sale: { ...records[1], customer_id: 8, customer_type: 'Credit Supplier', contact_number: '09171234567', address: 'Quezon City' }, items: [
  { salesitem_id: 1, product_id: 3, product_name: 'Chicken Breast', unit: 'kg', quantity: '2.000', price: '750.00', subtotal: '1500.00' },
  { salesitem_id: 2, product_id: 4, product_name: 'Chicken Wings', unit: 'kg', quantity: '2.000', price: '500.00', subtotal: '1000.00' },
], payments: [{ payment_id: 41, payment_amount: '500.00', remaining_balance: '2000.00', payment_date: '2026-10-21T11:00:00+08:00', recorded_by: 'Test Admin' }] }
const inventoryReport = { summary: { total_products: 4, total_inventory_cost_value: '1000.00', estimated_total_sales_value: '1620.00', low_stock_count: 1, out_of_stock_count: 1 }, records: [
  { product_id: 1, product_name: 'Whole Chicken', category: 'Whole Chicken', unit: 'kg', stock_quantity: '5', reorder_level: '2', inventory_cost_value: '500', estimated_sales_value: '800', status: 'In Stock' },
  { product_id: 2, product_name: 'Chicken Breast Fillet Extra Long Product Name', category: 'Chicken Parts', unit: 'kg', stock_quantity: '3.5', reorder_level: '4', inventory_cost_value: '300', estimated_sales_value: '520', status: 'Low Stock' },
  { product_id: 3, product_name: 'Chicken Wings', category: 'Chicken Parts', unit: 'kg', stock_quantity: '2', reorder_level: '1', inventory_cost_value: '200', estimated_sales_value: '300', status: 'In Stock' },
  { product_id: 4, product_name: 'Chicken Liver', category: 'Offal', unit: 'kg', stock_quantity: '0', reorder_level: '2', inventory_cost_value: null, estimated_sales_value: null, status: 'Out of Stock' },
] }
const receivablesReport = { summary: { customers_with_balance: 1, total_receivables: '2000.00' }, records: [{ customer_id: 8, customer_name: 'Maria Santos', contact_number: '09171234567', address: 'Quezon City', current_balance: '2000.00', total_original_credit_amount: '2500.00', open_credit_sales: 1, oldest_unpaid_sale_date: '2026-10-21T10:30:00+08:00' }] }

globalThis.fetch = async (input, options = {}) => {
  const path = new URL(String(input), location.origin).pathname
  if (path === '/api/reports/sales/202') return Response.json({ success: true, data: details })
  if (path === '/api/reports/sales') return Response.json({ success: true, data: salesReport })
  if (path === '/api/reports/inventory') return Response.json({ success: true, data: inventoryReport })
  if (path === '/api/reports/receivables') return Response.json({ success: true, data: receivablesReport })
  if (path === '/api/reports/log' && options.method === 'POST') return Response.json({ success: true, data: { report_id: 1 } }, { status: 201 })
  return Response.json({ success: false, message: 'Unexpected test request: ' + path }, { status: 404 })
}

createRoot(document.getElementById('root')).render(<main className="content-area"><Reports /></main>)
`)

  vite = await createServer({
    root: temporaryRoot,
    configFile: false,
    plugins: [react()],
    resolve: {
      alias: [
        { find: /^react$/, replacement: join(projectRoot, 'node_modules/react/index.js') },
        { find: /^react-dom\/client$/, replacement: join(projectRoot, 'node_modules/react-dom/client.js') },
        { find: /^react\/jsx-dev-runtime$/, replacement: join(projectRoot, 'node_modules/react/jsx-dev-runtime.js') },
        { find: /^react\/jsx-runtime$/, replacement: join(projectRoot, 'node_modules/react/jsx-runtime.js') },
      ],
    },
    server: { host: '127.0.0.1', port: vitePort, strictPort: true, fs: { allow: [projectRoot, temporaryRoot] } },
    logLevel: 'error',
  })
  await vite.listen()
  const pageUrl = `http://127.0.0.1:${vitePort}/`
  browser = spawn(chromePath, [`--remote-debugging-port=${browserPort}`, `--user-data-dir=${join(temporaryRoot, 'browser')}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000', pageUrl], { stdio: 'ignore', windowsHide: true })
  browserConnection = connectToBrowser(await waitForDebugger(browserPort, pageUrl))
  await browserConnection.ready
  await browserConnection.command('Runtime.enable')
  await browserConnection.command('Page.enable')

  async function evaluate(expression) {
    const result = await browserConnection.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  async function waitFor(expression) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error('Timed out waiting for browser condition: ' + expression)
  }

  async function setValue(selector, value) {
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); element.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await delay(80)
  }

  await waitFor("Boolean(document.querySelector('.sales-report-panel tbody tr'))")
  assert(!await evaluate("Boolean(document.querySelector('.report-page-intro'))"), 'Redundant Reports introduction card was still rendered')
  assert(await evaluate("document.querySelector('.report-result-count').textContent.includes('10 of 10')"), 'Initial report count was incorrect')
  assert(await evaluate("document.querySelector('.table-pagination').textContent.includes('Showing 1-8 of 10')"), 'Sales report pagination was not preserved')
  assert(await evaluate("document.querySelector('.sales-report-panel .table-scroll').getBoundingClientRect().right <= document.querySelector('.sales-report-panel').getBoundingClientRect().right"), 'Sales table overflowed its card')
  await mkdir(screenshotRoot, { recursive: true })
  let screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'desktop-sales-audit.png'), screenshot.data, 'base64')

  await setValue('.report-local-filters input', 'OR-202')
  assert(await evaluate("document.querySelector('.report-result-count').textContent.includes('1 of 10')"), 'Formatted transaction ID search was inaccurate')
  assert(await evaluate("document.querySelector('.sales-report-panel tbody').textContent.includes('Maria Santos')"), 'Formatted ID search returned the wrong transaction')
  await setValue('.report-local-filters input', '')
  await setValue('.report-local-filters select', 'Unpaid')
  assert(await evaluate("document.querySelector('.report-result-count').textContent.includes('1 of 10')"), 'Payment-status filtering was inaccurate')
  assert(await evaluate("document.querySelector('.sales-report-panel tbody').textContent.includes('OR-203')"), 'Unpaid status filter returned the wrong transaction')

  await setValue('.report-local-filters select', '')
  await evaluate("[...document.querySelectorAll('.report-transaction-link')].find((button) => button.textContent.includes('OR-202')).click()")
  await waitFor("Boolean(document.querySelector('.report-transaction-modal .report-detail-content'))")
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Chicken Breast') && document.querySelector('[role=dialog]').textContent.includes('₱750.00')"), 'Historical sale items and prices were not displayed')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Credit Supplier') && document.querySelector('[role=dialog]').textContent.includes('09171234567')"), 'Customer audit details were incomplete')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Payment #41') && document.querySelector('[role=dialog]').textContent.includes('Oct 21, 2026, 10:30 AM')"), 'Payment records or Manila transaction timestamp were missing')
  assert(!await evaluate("document.querySelector('[role=dialog]').textContent.includes('PHT')"), 'Transaction modal displayed a prohibited timezone suffix')
  assert(await evaluate("document.activeElement?.classList.contains('close-button')"), 'Shared modal did not receive its expected initial focus')
  const backdrop = await evaluate(`(() => { const rect = document.querySelector('.modal-backdrop').getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: document.body.style.overflow } })()`)
  assert(backdrop.left === 0 && backdrop.top === 0 && backdrop.width === backdrop.viewportWidth && backdrop.height === backdrop.viewportHeight, 'Transaction backdrop did not cover the viewport')
  assert(backdrop.overflow === 'hidden', 'Transaction modal did not lock background scrolling')

  screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'desktop-transaction-details.png'), screenshot.data, 'base64')
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor("!document.querySelector('[role=dialog]')")

  await evaluate("[...document.querySelectorAll('.tabs button')].find((button) => button.textContent.includes('Inventory Assets')).click()")
  await waitFor("document.body.textContent.includes('Inventory Assets Valuation')")
  assert(await evaluate("document.body.textContent.includes('Whole Chicken') && document.body.textContent.includes('FIFO Stock Cost') && document.body.textContent.includes('₱1,000.00')"), 'Inventory report tab or summary cards did not retain their data')
  assert(await evaluate("document.querySelector('.valuation-donut').dataset.chartTotal === '1000.00' && !document.querySelector('.valuation-reconciliation-warning')"), 'Product chart values did not reconcile with the authoritative report total')
  assert(await evaluate("document.querySelectorAll('.valuation-donut-segment').length === 3 && document.querySelectorAll('.valuation-legend button').length === 3"), 'Zero-value products were not handled consistently in the chart and legend')
  assert(await evaluate("new Set([...document.querySelectorAll('.valuation-donut-segment')].map((segment) => segment.getAttribute('stroke'))).size === 3"), 'Product chart colors were not distinguishable')
  const colorsBeforeSort = await evaluate("[...document.querySelectorAll('.valuation-donut-segment')].map((segment) => segment.getAttribute('stroke')).join('|')")
  await evaluate("document.querySelector('.inventory-report-panel th button').click()")
  const colorsAfterSort = await evaluate("[...document.querySelectorAll('.valuation-donut-segment')].map((segment) => segment.getAttribute('stroke')).join('|')")
  assert(colorsBeforeSort === colorsAfterSort, 'Product chart colors changed after table sorting')
  await evaluate("document.querySelectorAll('.valuation-donut-segment')[1].focus()")
  await waitFor("document.querySelector('.valuation-tooltip').textContent.includes('Chicken Breast Fillet')")
  assert(await evaluate("document.querySelector('.valuation-tooltip').textContent.includes('₱300.00') && document.querySelector('.valuation-tooltip').textContent.includes('30.0%') && document.querySelector('.valuation-tooltip').textContent.includes('3.5 kg') && document.querySelector('.valuation-tooltip').textContent.includes('Chicken Parts')"), 'Product hover/focus details were incomplete or inaccurate')
  await evaluate("document.querySelectorAll('.valuation-legend button')[2].click()")
  assert(await evaluate("document.querySelector('.valuation-tooltip').textContent.includes('Chicken Wings') && document.querySelectorAll('.valuation-donut-segment')[2].getAttribute('aria-pressed') === 'true'"), 'Legend selection did not expose the matching product segment')
  screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'desktop-inventory-valuation.png'), screenshot.data, 'base64')

  await browserConnection.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await delay(150)
  assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'Inventory valuation overflowed the mobile viewport')
  assert(await evaluate("document.querySelector('.inventory-valuation-chart-panel').getBoundingClientRect().width <= document.documentElement.clientWidth - 32"), 'Inventory valuation chart card did not fit the mobile content width')
  await evaluate("document.querySelector('.inventory-valuation-chart-panel').scrollIntoView({ block: 'start' })")
  await delay(100)
  screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'mobile-inventory-valuation.png'), screenshot.data, 'base64')

  await evaluate("[...document.querySelectorAll('.tabs button')].find((button) => button.textContent.includes('Credit Receivables')).click()")
  await waitFor("document.body.textContent.includes('Credit Receivables Ledger')")
  assert(await evaluate("document.body.textContent.includes('Maria Santos') && document.body.textContent.includes('₱2,500.00') && document.body.textContent.includes('₱2,000.00')"), 'Receivables report tab did not retain credit and balance data')
  assert(await evaluate("document.body.textContent.includes('Oct 21, 2026, 10:30 AM') && !document.body.textContent.includes('PHT')"), 'Receivables timestamp was not the expected Manila date/time format')

  assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'Reports page overflowed the mobile viewport')
  screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'mobile-receivables.png'), screenshot.data, 'base64')

  console.log('PASS formatted transaction/customer search, status filtering, result count, and pagination')
  console.log('PASS historical products, prices, customer details, payment records, and Manila timestamps')
  console.log('PASS shared modal focus, Escape, scroll lock, and full-viewport backdrop')
  console.log('PASS product-level valuation reconciliation, stable colors, keyboard details, legend selection, and zero-value handling')
  console.log('PASS inventory and receivables tabs, PHP formatting, and mobile containment')
  console.log(`REPORT_SCREENSHOTS ${screenshotRoot}`)
} finally {
  browserConnection?.socket.close()
  if (browser && browser.exitCode === null) {
    browser.kill()
    await Promise.race([new Promise((resolveExit) => browser.once('exit', resolveExit)), delay(3000)])
  }
  if (vite) await vite.close()
  if (resolve(temporaryRoot).startsWith(safeTempRoot)) await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
