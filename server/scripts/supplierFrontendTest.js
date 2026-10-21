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
  throw new Error('Timed out waiting for the supplier browser test')
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
const screenshotRoot = join(projectRoot, 'test-results', 'supplier-contracts')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lcp-suppliers-ui-'))
const safeTempRoot = `${resolve(tmpdir())}${sep}`
const browserPort = await getFreePort()
const vitePort = await getFreePort()
const chromePath = findChrome()
let browser
let vite
let browserConnection

try {
  assert(resolve(temporaryRoot).startsWith(safeTempRoot), 'Unsafe temporary test directory')
  assert(chromePath, 'Chrome or Edge is required for the supplier UI test')
  const sourceRoot = projectRoot.replaceAll('\\', '/')

  await writeFile(join(temporaryRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>')
  await writeFile(join(temporaryRoot, 'harness.jsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '/@fs/${sourceRoot}/src/context/ThemeContext.jsx'
import MainLayout from '/@fs/${sourceRoot}/src/layouts/MainLayout.jsx'
import SupplierContracts from '/@fs/${sourceRoot}/src/pages/SupplierContracts/SupplierContracts.jsx'
import '/@fs/${sourceRoot}/src/styles/variables.css'
import '/@fs/${sourceRoot}/src/styles/global.css'
import '/@fs/${sourceRoot}/src/styles/shared/Forms.css'
import '/@fs/${sourceRoot}/src/styles/shared/Cards.css'
import '/@fs/${sourceRoot}/src/styles/shared/Shared.css'
import '/@fs/${sourceRoot}/src/styles/shared/Tables.css'
import '/@fs/${sourceRoot}/src/styles/shared/Modal.css'
import '/@fs/${sourceRoot}/src/styles/layouts/MainLayout.css'
import '/@fs/${sourceRoot}/src/styles/layouts/Header.css'
import '/@fs/${sourceRoot}/src/styles/layouts/Sidebar.css'
import '/@fs/${sourceRoot}/src/styles/pages/SupplierContracts.css'

localStorage.setItem('authToken', 'supplier-test-token')
localStorage.setItem('theme', 'light')

let suppliers = [
  { supplier_id: 1, supplier_name: 'Luzon Poultry Supply', contact_person: 'Ana Cruz', contact_number: '09171234567', address: 'Quezon City' },
  { supplier_id: 2, supplier_name: 'Visayas Cold Chain', contact_person: 'Ben Santos', contact_number: '', address: 'Cebu City' },
  { supplier_id: 3, supplier_name: 'Mindanao Farm Goods', contact_person: '', contact_number: '09981234567', address: 'Davao City' },
]
const deliveries = Array.from({ length: 10 }, (_, index) => ({
  stockin_id: 51 + index,
  supplier_id: index < 2 ? 1 : (index % 2) + 2,
  supplier_name: index < 2 ? 'Luzon Poultry Supply' : (index % 2 ? 'Visayas Cold Chain' : 'Mindanao Farm Goods'),
  product_id: index + 1,
  product_name: index === 0 ? 'Whole Chicken Premium Long Product Name' : 'Chicken Product ' + (index + 1),
  unit: 'kg',
  quantity_received: String(index + 2),
  remaining_quantity: String(index + 1),
  cost_price: '100.00',
  total_cost: String((index + 2) * 100),
  delivery_date: '2026-10-21T16:28:00+08:00',
  recorded_by: 'Test Admin',
}))
let supplierPostCount = 0
let failNextSupplier = false

globalThis.fetch = async (input, options = {}) => {
  const path = new URL(String(input), location.origin).pathname
  if (path === '/api/suppliers' && (!options.method || options.method === 'GET')) {
    return Response.json({ success: true, data: suppliers })
  }
  if (path === '/api/stock-in' && (!options.method || options.method === 'GET')) {
    return Response.json({ success: true, data: deliveries })
  }
  if (path === '/api/suppliers' && options.method === 'POST') {
    supplierPostCount += 1
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120))
    if (failNextSupplier) {
      failNextSupplier = false
      return Response.json({ success: false, message: 'Controlled supplier failure' }, { status: 500 })
    }
    const supplier = { supplier_id: 100 + supplierPostCount, ...JSON.parse(options.body) }
    suppliers = [...suppliers, supplier]
    return Response.json({ success: true, data: { supplier_id: supplier.supplier_id } }, { status: 201 })
  }
  return Response.json({ success: false, message: 'Unexpected test request: ' + path }, { status: 404 })
}

globalThis.supplierTestState = {
  get postCount() { return supplierPostCount },
  failNext() { failNextSupplier = true },
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <MainLayout activeModule="Supplier Contracts" role="admin" user={{ fullname: 'Test Admin' }} onSelect={() => {}} onLogout={() => {}}>
      <SupplierContracts />
    </MainLayout>
  </ThemeProvider>,
)
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
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw new Error('Timed out waiting for browser condition: ' + expression)
  }

  async function setValue(selector, value) {
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); })()`)
    await delay(80)
  }

  async function clickByText(text) {
    await evaluate(`[...document.querySelectorAll('button')].find((button) => button.textContent.trim().includes(${JSON.stringify(text)}))?.click()`)
    await delay(80)
  }

  await waitFor("document.querySelectorAll('.supplier-card').length === 3 && Boolean(document.querySelector('.supplier-ledger-panel tbody tr'))")
  assert(!await evaluate("Boolean(document.querySelector('.page-intro'))"), 'Redundant Supplier Contracts introduction banner was rendered')
  assert(await evaluate("document.querySelector('.supplier-card').textContent.includes('2') && document.querySelector('.supplier-card').textContent.includes('₱500.00')"), 'Supplier card did not use real delivery totals')
  assert(!await evaluate("document.body.textContent.includes('Volume: —') || document.body.textContent.includes('Total Spend: —')"), 'Misleading placeholder metrics remain')
  assert(await evaluate("document.querySelector('.table-pagination').textContent.includes('Showing 1-8 of 10')"), 'Delivery pagination was not available')
  assert(await evaluate("document.querySelector('.supplier-ledger-panel tbody').textContent.includes('Oct 21, 2026, 4:28 PM') && !document.body.textContent.includes('PHT')"), 'Delivery timestamp was not displayed in the established Manila format')
  assert(await evaluate("document.querySelector('.supplier-ledger-panel .table-scroll').getBoundingClientRect().right <= document.querySelector('.supplier-ledger-panel').getBoundingClientRect().right"), 'Delivery table overflowed its panel')

  await mkdir(screenshotRoot, { recursive: true })
  let screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'desktop-directory.png'), screenshot.data, 'base64')

  await setValue('.supplier-directory-controls input', 'Davao')
  assert(await evaluate("document.querySelectorAll('.supplier-card').length === 1 && document.body.textContent.includes('Mindanao Farm Goods')"), 'Supplier search did not match supported address fields')
  await setValue('.supplier-directory-controls input', '')
  await setValue('.supplier-ledger-panel .table-search input', 'Whole Chicken Premium')
  assert(await evaluate("document.querySelector('.supplier-ledger-panel .table-pagination').textContent.includes('Showing 1-1 of 1')"), 'Delivery search did not filter the ledger')
  await setValue('.supplier-ledger-panel .table-search input', '')
  await clickByText('Add Supplier')
  await waitFor("Boolean(document.querySelector('.supplier-form-modal'))")
  const backdrop = await evaluate(`(() => { const rect = document.querySelector('.modal-backdrop').getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: document.body.style.overflow, focusInDialog: document.querySelector('[role=dialog]').contains(document.activeElement) } })()`)
  assert(backdrop.left === 0 && backdrop.top === 0 && backdrop.width === backdrop.viewportWidth && backdrop.height === backdrop.viewportHeight, 'Supplier modal backdrop did not cover the full viewport')
  assert(backdrop.overflow === 'hidden' && backdrop.focusInDialog, 'Supplier modal focus or scroll locking was incorrect')
  await clickByText('Review Supplier')
  assert(await evaluate("document.querySelector('[role=alert]')?.textContent.includes('required')"), 'Required supplier-name validation did not run')
  await setValue('input[name=supplier_name]', 'Central Chicken Traders')
  await setValue('input[name=contact_person]', 'Carla Reyes')
  await setValue('input[name=contact_number]', '09190001111')
  await setValue('textarea[name=address]', 'Makati City')
  await clickByText('Review Supplier')
  await waitFor("Boolean(document.querySelector('.supplier-review-modal'))")
  assert(await evaluate("supplierTestState.postCount === 0 && document.querySelector('[role=dialog]').textContent.includes('Central Chicken Traders')"), 'Review step submitted early or omitted entered details')
  screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'desktop-review.png'), screenshot.data, 'base64')
  await evaluate("[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Confirm Supplier')).click(); [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Confirm Supplier')).click()")
  await waitFor("Boolean(document.querySelector('.transaction-success-modal'))")
  assert(await evaluate("supplierTestState.postCount === 1"), 'Duplicate confirmation created more than one supplier request')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('SUP-101') && document.querySelector('[role=dialog]').textContent.includes('Central Chicken Traders')"), 'Success modal did not show backend-confirmed supplier details')
  screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'desktop-success.png'), screenshot.data, 'base64')
  await clickByText('Done')
  await waitFor("!document.querySelector('[role=dialog]') && document.querySelectorAll('.supplier-card').length === 4")

  await clickByText('Add Supplier')
  await setValue('input[name=supplier_name]', 'Failure Preserved Supplier')
  await clickByText('Review Supplier')
  await evaluate('supplierTestState.failNext()')
  await clickByText('Confirm Supplier')
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('Controlled supplier failure')")
  assert(!await evaluate("Boolean(document.querySelector('.transaction-success-modal'))"), 'Failed request incorrectly displayed success')
  await clickByText('Back')
  assert(await evaluate("document.querySelector('input[name=supplier_name]').value === 'Failure Preserved Supplier'"), 'Failed submission did not preserve entered supplier values')
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor("!document.querySelector('[role=dialog]')")

  await browserConnection.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await delay(180)
  assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'Supplier page overflowed the mobile viewport')
  assert(await evaluate("getComputedStyle(document.querySelector('.supplier-grid')).gridTemplateColumns.split(' ').length === 1"), 'Supplier cards did not stack on mobile')
  screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(screenshotRoot, 'mobile-supplier-page.png'), screenshot.data, 'base64')

  console.log('PASS supplier search, real delivery totals, PHP formatting, delivery search and pagination')
  console.log('PASS review, backend-confirmed success, failure preservation, and duplicate-submit protection')
  console.log('PASS shared modal viewport coverage, focus containment, scroll lock, Escape, and mobile containment')
  console.log(`SUPPLIER_SCREENSHOTS ${screenshotRoot}`)
} finally {
  browserConnection?.socket.close()
  if (browser && browser.exitCode === null) {
    browser.kill()
    await Promise.race([new Promise((resolveExit) => browser.once('exit', resolveExit)), delay(3000)])
  }
  if (vite) await vite.close()
  if (resolve(temporaryRoot).startsWith(safeTempRoot)) await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
