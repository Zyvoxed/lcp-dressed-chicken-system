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

function findBrowser() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean).find((candidate) => existsSync(candidate))
}

async function waitForDebugger(port, pageUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const pages = await response.json()
      const page = pages.find((candidate) => candidate.url.startsWith(pageUrl))
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      // Browser is still starting.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for the transaction browser test')
}

function connectToBrowser(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl)
  const pending = new Map()
  let commandId = 0

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolveCommand, rejectCommand, method, description } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) rejectCommand(new Error(`${method}: ${message.error.message}${description ? ` (${description})` : ''}`))
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
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(commandId, { resolveCommand, rejectCommand, method, description: params.expression?.slice(0, 180) })
      })
    },
  }
}

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const screenshotRoot = join(projectRoot, 'test-results', 'record-sales')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lcp-transactions-ui-'))
const safeTempRoot = `${resolve(tmpdir())}${sep}`
const browserPort = await getFreePort()
const vitePort = await getFreePort()
const browserPath = findBrowser()
let browser
let vite
let browserConnection

try {
  assert(resolve(temporaryRoot).startsWith(safeTempRoot), 'Unsafe temporary test directory')
  assert(browserPath, 'Chrome or Edge is required for transaction UI tests')

  const sourceRoot = projectRoot.replaceAll('\\', '/')
  await writeFile(join(temporaryRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>')
  await writeFile(join(temporaryRoot, 'harness.jsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '/@fs/${sourceRoot}/src/context/ThemeContext.jsx'
import MainLayout from '/@fs/${sourceRoot}/src/layouts/MainLayout.jsx'
import RecordSales from '/@fs/${sourceRoot}/src/pages/RecordSales/RecordSales.jsx'
import CustomerCredits from '/@fs/${sourceRoot}/src/pages/CustomerCredits/CustomerCredits.jsx'
import '/@fs/${sourceRoot}/src/styles/variables.css'
import '/@fs/${sourceRoot}/src/styles/global.css'
import '/@fs/${sourceRoot}/src/styles/layouts/MainLayout.css'
import '/@fs/${sourceRoot}/src/styles/layouts/Header.css'
import '/@fs/${sourceRoot}/src/styles/layouts/Sidebar.css'
import '/@fs/${sourceRoot}/src/styles/shared/Cards.css'
import '/@fs/${sourceRoot}/src/styles/shared/Forms.css'
import '/@fs/${sourceRoot}/src/styles/shared/Shared.css'
import '/@fs/${sourceRoot}/src/styles/shared/Modal.css'
import '/@fs/${sourceRoot}/src/styles/pages/RecordSales.css'
import '/@fs/${sourceRoot}/src/styles/pages/CustomerCredits.css'

const products = [
  { product_id: 1, product_name: 'Premium Whole Chicken With A Long Product Name', category: 'Whole Chicken', unit: 'kg', selling_price: '120.00', stock_quantity: '10.000', reorder_level: '2.000', status: 'Available' },
  { product_id: 2, product_name: 'Chicken Liver', category: 'Innards & Offal', unit: 'kg', selling_price: '80.00', stock_quantity: '3.000', reorder_level: '1.000', status: 'Available' },
  { product_id: 3, product_name: 'Sold Out Wings', category: 'Wings and Drumsticks', unit: 'kg', selling_price: '95.00', stock_quantity: '0.000', reorder_level: '2.000', status: 'Out of Stock' },
]
const customers = [
  { customer_id: 7, customer_name: 'Maria Santos', contact_number: '09171234567', address: 'Quezon City', current_balance: '300.00', created_at: '2026-10-01T08:00:00+08:00', is_active: true },
  { customer_id: 8, customer_name: 'Juan Cash Customer', contact_number: null, address: '', current_balance: '0.00', created_at: '2026-10-02T08:00:00+08:00', is_active: true },
  ...Array.from({ length: 6 }, (_, index) => ({ customer_id: 20 + index, customer_name: 'Fixture Customer ' + (index + 1), contact_number: '0900000000' + index, address: 'Test Address', current_balance: '0.00', created_at: '2026-10-03T08:00:00+08:00', is_active: true })),
]
const credits = [{ sale_id: 700, sale_date: '2026-10-20T09:30:00+08:00', total_amount: '500.00', amount_paid: '200.00', remaining_balance: '300.00', status: 'Partially Paid', recorded_by: 'Transaction Test Admin' }]
const payments = [{ payment_id: 900, sale_id: 700, payment_amount: '200.00', remaining_balance: '300.00', payment_date: '2026-10-20T10:15:00+08:00', recorded_by: 'Transaction Test Admin' }]
globalThis.salesRequests = []
globalThis.paymentRequests = []
globalThis.customerRequests = []
globalThis.productLoads = 0
globalThis.ledgerRefreshes = 0
globalThis.saleShouldFail = false
globalThis.paymentShouldFail = false
globalThis.nextCustomerId = 9
localStorage.setItem('authToken', 'transaction-ui-test-token')

globalThis.fetch = async (url, options = {}) => {
  const path = String(url)
  const method = options.method || 'GET'
  if (path.endsWith('/products') && method === 'GET') {
    globalThis.productLoads += 1
    return new Response(JSON.stringify({ success: true, data: products }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const pathParts = new URL(path).pathname.split('/').filter(Boolean)
  const customerId = Number(pathParts[2])
  if (pathParts.length === 3 && pathParts[1] === 'customers' && Number.isInteger(customerId) && method === 'GET') {
    const customer = customers.find((item) => item.customer_id === customerId)
    return new Response(JSON.stringify({ success: true, data: customer }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (pathParts.length === 4 && pathParts[1] === 'customers' && pathParts[3] === 'credits' && method === 'GET') {
    return new Response(JSON.stringify({ success: true, data: customerId === 7 ? credits : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (pathParts.length === 4 && pathParts[1] === 'customers' && pathParts[3] === 'payments' && method === 'GET') {
    return new Response(JSON.stringify({ success: true, data: customerId === 7 ? payments : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/customers') && method === 'GET') {
    return new Response(JSON.stringify({ success: true, data: customers }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/customers') && method === 'POST') {
    const body = JSON.parse(options.body)
    globalThis.customerRequests.push(body)
    const customer = { customer_id: globalThis.nextCustomerId, ...body, current_balance: '0.00', created_at: '2026-10-21T09:00:00+08:00', is_active: true }
    globalThis.nextCustomerId += 1
    customers.push(customer)
    return new Response(JSON.stringify({ success: true, data: { customer_id: customer.customer_id } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/sales') && method === 'POST') {
    const body = JSON.parse(options.body)
    globalThis.salesRequests.push(body)
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 100))
    if (globalThis.saleShouldFail) {
      return new Response(JSON.stringify({ success: false, message: 'Not enough stock for product 1' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    }
    const total = body.items.reduce((sum, item) => sum + Number(products.find((product) => product.product_id === item.product_id).selling_price) * item.quantity, 0)
    return new Response(JSON.stringify({
      success: true,
      data: {
        sale_id: 500 + globalThis.salesRequests.length,
        total_amount: total.toFixed(2),
        amount_paid: Number(body.amount_paid).toFixed(2),
        remaining_balance: (total - Number(body.amount_paid)).toFixed(2),
        status: total === Number(body.amount_paid) ? 'Paid' : Number(body.amount_paid) > 0 ? 'Partially Paid' : 'Unpaid',
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/payments') && method === 'POST') {
    const body = JSON.parse(options.body)
    globalThis.paymentRequests.push(body)
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 100))
    if (globalThis.paymentShouldFail) {
      return new Response(JSON.stringify({ success: false, message: 'Payment exceeds the outstanding balance' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const remainingBalance = (Number(credits[0].remaining_balance) - Number(body.payment_amount)).toFixed(2)
    credits[0].amount_paid = (Number(credits[0].amount_paid) + Number(body.payment_amount)).toFixed(2)
    credits[0].remaining_balance = remainingBalance
    credits[0].status = Number(remainingBalance) === 0 ? 'Paid' : 'Partially Paid'
    customers[0].current_balance = remainingBalance
    const paymentId = 900 + globalThis.paymentRequests.length
    payments.unshift({ payment_id: paymentId, sale_id: Number(body.sale_id), payment_amount: Number(body.payment_amount).toFixed(2), remaining_balance: remainingBalance, payment_date: '2026-10-21T14:45:00+08:00', recorded_by: 'Transaction Test Admin' })
    return new Response(JSON.stringify({ success: true, data: { payment_id: paymentId, sale_id: Number(body.sale_id), payment_amount: Number(body.payment_amount).toFixed(2), remaining_balance: remainingBalance, status: credits[0].status } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ success: false, message: 'Unexpected test request' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
}

function Harness() {
  return <ThemeProvider>
    <MainLayout activeModule="Record Sales" role="admin" user={{ fullname: 'Transaction Test Admin' }} onSelect={() => {}} onLogout={() => {}}>
      <section id="record-sales-test"><RecordSales /></section>
      <section id="customer-credits-test"><CustomerCredits /></section>
    </MainLayout>
  </ThemeProvider>
}

createRoot(document.getElementById('root')).render(<Harness />)
`)

  vite = await createServer({
    root: temporaryRoot,
    configFile: false,
    logLevel: 'error',
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
  })
  await vite.listen()

  const pageUrl = `http://127.0.0.1:${vitePort}/`
  browser = spawn(browserPath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${browserPort}`, `--user-data-dir=${join(temporaryRoot, 'browser-profile')}`, pageUrl,
  ], { stdio: 'ignore', windowsHide: true })

  const webSocketUrl = await waitForDebugger(browserPort, pageUrl)
  browserConnection = connectToBrowser(webSocketUrl)
  await browserConnection.ready
  await browserConnection.command('Runtime.enable')
  await browserConnection.command('Page.enable')

  async function evaluate(expression) {
    const result = await browserConnection.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed')
    return result.result.value
  }

  async function waitFor(expression, message) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate(expression)) return
      await delay(50)
    }
    throw new Error(message)
  }

  async function click(expression) {
    const clicked = await evaluate(`(() => { const element = ${expression}; if (!element) return false; element.click(); return true })()`)
    assert(clicked, `Could not click ${expression}`)
    await delay(50)
  }

  async function setInput(expression, value) {
    const changed = await evaluate(`(() => {
      const element = ${expression}
      if (!element) return false
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
      setter.call(element, ${JSON.stringify(value)})
      element.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    assert(changed, `Could not update ${expression}`)
    await delay(50)
  }

  async function setSelect(expression, value) {
    const changed = await evaluate(`(() => {
      const element = ${expression}
      if (!element) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(element, ${JSON.stringify(value)})
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`)
    assert(changed, `Could not update ${expression}`)
    await delay(50)
  }

  async function capture(fileName, width, focusExpression) {
    await browserConnection.command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width <= 520 })
    if (focusExpression) await evaluate(`${focusExpression}?.scrollIntoView({ block: 'start' })`)
    await delay(150)
    const screenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    await writeFile(join(screenshotRoot, fileName), screenshot.data, 'base64')
  }

  async function assertFullViewportBackdrop(label) {
    const result = await evaluate(`(() => {
      const backdrop = document.querySelector('.modal-backdrop')
      const header = document.querySelector('.topbar')
      const sidebar = document.querySelector('.sidebar')
      const rect = backdrop?.getBoundingClientRect()
      const headerRect = header?.getBoundingClientRect()
      const sidebarRect = sidebar?.getBoundingClientRect()
      return {
        parentIsBody: backdrop?.parentElement === document.body,
        coversViewport: rect && rect.left <= 0 && rect.top <= 0 && rect.right >= innerWidth && rect.bottom >= innerHeight,
        coversHeader: headerRect && document.elementFromPoint(headerRect.left + 10, headerRect.top + 10) === backdrop,
        coversSidebar: sidebarRect && document.elementFromPoint(sidebarRect.left + 10, sidebarRect.top + 10) === backdrop,
        backdropZ: Number(getComputedStyle(backdrop).zIndex),
        headerZ: Number(getComputedStyle(header).zIndex),
        sidebarZ: Number(getComputedStyle(sidebar).zIndex),
        hasBlur: getComputedStyle(backdrop).backdropFilter.includes('blur'),
        bodyLocked: document.body.style.overflow === 'hidden',
      }
    })()`)
    assert(result.parentIsBody, `${label} was not portaled outside the page transition stacking context`)
    assert(result.coversViewport && result.coversHeader && result.coversSidebar, `${label} did not cover the viewport, header, and sidebar`)
    assert(result.backdropZ > result.headerZ && result.backdropZ > result.sidebarZ, `${label} was below a layout layer`)
    assert(result.hasBlur && result.bodyLocked, `${label} did not preserve blur and scroll locking`)
  }

  await waitFor("document.querySelectorAll('#record-sales-test .product-card').length === 3", 'Record Sales products did not load')
  await mkdir(screenshotRoot, { recursive: true })
  await capture('desktop-record-sales.png', 1440, "document.querySelector('#record-sales-test')")

  await setInput("document.querySelector('#record-sales-test .search-field input')", 'Liver')
  assert(await evaluate("document.querySelectorAll('#record-sales-test .product-card').length") === 1, 'Product search did not filter the catalog')
  await setInput("document.querySelector('#record-sales-test .search-field input')", '')
  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Sold Out Wings'))")
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 0, 'Out-of-stock product was selectable')

  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken'))")
  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Chicken Liver'))")
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 2, 'Multiple products were not added')
  await click("document.querySelector('#record-sales-test .basket-item .quantity-stepper button:last-child')")
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item input').value") === '2', 'Quantity increase did not update immediately')
  await setInput("document.querySelector('#record-sales-test .basket-item input')", '-2')
  assert(await evaluate("Number(document.querySelector('#record-sales-test .basket-item input').value)") === 0.001, 'Negative quantity was not prevented')
  await click("document.querySelectorAll('#record-sales-test .basket-remove-button')[1]")
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 1, 'Remove-item action did not work')
  await setInput("document.querySelector('#record-sales-test .basket-item input')", '1')
  await capture('desktop-populated-cart.png', 1440, "document.querySelector('#record-sales-test .basket-panel')")
  await capture('desktop-payment-section.png', 1440, "document.querySelector('#record-sales-test .basket-section')")

  await setInput("document.querySelector('#record-sales-test .basket-section input')", '120')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  assert(await evaluate('salesRequests.length') === 0, 'Opening confirmation submitted the sale')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent") === 'Confirm Sales Transaction', 'Pre-submission confirmation did not open')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Customer Information') && document.querySelector('[role=dialog]').textContent.includes('Order Items') && document.querySelector('[role=dialog]').textContent.includes('Payment Details') && document.querySelector('[role=dialog]').textContent.includes('Transaction Total')"), 'Confirmation sections were incomplete')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Walk-in Customer') && !document.querySelector('[role=dialog]').textContent.includes('Contact number') && !document.querySelector('[role=dialog]').textContent.includes('Address')"), 'Anonymous walk-in details were inaccurate')
  await assertFullViewportBackdrop('Sale confirmation backdrop')
  assert(await evaluate("document.activeElement?.getAttribute('aria-label')") === 'Close modal', 'Confirmation did not receive accessible initial focus')
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert(await evaluate("document.activeElement?.textContent.trim()") === 'Return to Editing', 'Confirmation Tab order did not reach the return action')
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await waitFor("!document.querySelector('[role=dialog]')", 'Escape did not close confirmation')
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 1, 'Escape cleared the cart')
  assert(await evaluate("document.body.style.overflow") === '', 'Closing confirmation did not restore background scrolling')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await capture('desktop-sale-confirmation.png', 1440, "document.querySelector('[role=dialog]')")
  await click("document.querySelector('[role=dialog] .secondary-action')")
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 1, 'Canceling confirmation cleared the cart')

  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await evaluate("(() => { const button = document.querySelector('[role=dialog] .primary-action'); button.click(); button.click() })()")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'Cash sale success modal did not open')
  await assertFullViewportBackdrop('Sale success backdrop')
  assert(await evaluate('salesRequests.length') === 1, 'Repeated confirmation created duplicate sale requests')
  assert(await evaluate('salesRequests[0].customer_id') === null, 'Anonymous walk-in sale was associated with a fabricated customer')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('OR-501') && document.querySelector('[role=dialog]').textContent.includes('\\u20b1120.00')"), 'Sale success modal omitted actual API values')
  assert(!await evaluate("document.querySelector('[role=dialog]').textContent.includes('Transaction date')"), 'Sale success modal fabricated an unavailable timestamp')
  assert(await evaluate("document.activeElement?.getAttribute('aria-label')") === 'Close modal', 'Success modal did not receive accessible initial focus')
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert(await evaluate("document.activeElement?.textContent.trim()") === 'Done', 'Success modal Tab order did not reach Done')
  await capture('desktop-sale-success.png', 1440, "document.querySelector('[role=dialog]')")
  await click("document.querySelector('[role=dialog] .transaction-done-button')")
  await waitFor("!document.querySelector('[role=dialog]')", 'Done did not close sale success')
  assert(await evaluate('salesRequests.length') === 1, 'Done resubmitted the sale')
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 0, 'Done did not reset the successful sale')
  assert(await evaluate('productLoads >= 2'), 'Done did not refresh product stock')

  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '120')
  await setSelect("document.querySelector('#record-sales-test .basket-section select')", '7')
  await setSelect("document.querySelector('#record-sales-test .basket-section select')", '8')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-section select').value") === '8', 'Switching walk-in customers did not retain the latest selection')
  await evaluate('saleShouldFail = true')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Walk-in') && document.querySelector('[role=dialog]').textContent.includes('Juan Cash Customer')"), 'Existing walk-in customer was not shown')
  assert(!await evaluate("document.querySelector('[role=dialog]').textContent.includes('Contact number') || document.querySelector('[role=dialog]').textContent.includes('Address')"), 'Missing optional walk-in fields were not omitted')
  await evaluate("(() => { const button = document.querySelector('[role=dialog] .primary-action'); button.click(); button.click() })()")
  await waitFor("Boolean(document.querySelector('[role=dialog] .sales-feedback.error'))", 'Failed sale did not show an error')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent") === 'Confirm Sales Transaction', 'Failed sale incorrectly opened success')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-section input').value") === '120', 'Failed sale did not preserve payment input')
  assert(await evaluate('salesRequests.at(-1).customer_id') === 8, 'Selected walk-in customer was not associated with the submitted request')
  await evaluate('saleShouldFail = false')
  await click("document.querySelector('[role=dialog] .secondary-action')")

  await click("[...document.querySelectorAll('#record-sales-test .payment-methods button')].find((button) => button.textContent.includes('Credit'))")
  await setSelect("document.querySelector('#record-sales-test .basket-section select')", '7')
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '20')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Credit Supplier') && document.querySelector('[role=dialog]').textContent.includes('Maria Santos') && document.querySelector('[role=dialog]').textContent.includes('09171234567') && document.querySelector('[role=dialog]').textContent.includes('Quezon City') && document.querySelector('[role=dialog]').textContent.includes('Existing outstanding balance') && document.querySelector('[role=dialog]').textContent.includes('\\u20b1300.00')"), 'Credit customer details were incomplete')
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'Credit sale success modal did not open')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Maria Santos') && document.querySelector('[role=dialog]').textContent.includes('\\u20b1100.00')"), 'Credit success details were inaccurate')
  assert(await evaluate('salesRequests.at(-1).customer_id') === 7, 'Credit sale was associated with the wrong customer')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")

  await click("document.querySelector('#record-sales-test .add-customer-button')")
  await setInput("document.querySelector('[role=dialog] input[name=customer_name]')", 'New Walk-in Buyer')
  await setInput("document.querySelector('[role=dialog] input[name=contact_number]')", '09998887777')
  await setInput("document.querySelector('[role=dialog] [name=address]')", 'Pasig City')
  await evaluate("(() => { const button = document.querySelector('[role=dialog] .primary-action'); button.click(); button.click() })()")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Customer Added Successfully!'", 'Add Customer success modal did not open')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('CUS-9') && document.querySelector('[role=dialog]').textContent.includes('New Walk-in Buyer')"), 'Add Customer success omitted actual saved details')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")
  await waitFor("!document.querySelector('[role=dialog]')", 'Add Customer Done did not close the modal')
  await waitFor("document.querySelector('#record-sales-test .basket-section select').value === '9'", 'New customer was not selected immediately')
  assert(await evaluate('customerRequests.length') === 1, 'New walk-in customer was submitted more than once')
  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Chicken Liver'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '80')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('New Walk-in Buyer') && document.querySelector('[role=dialog]').textContent.includes('09998887777') && document.querySelector('[role=dialog]').textContent.includes('Pasig City')"), 'New walk-in customer details were not shown without reloading')
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'New walk-in sale success modal did not open')
  assert(await evaluate('salesRequests.at(-1).customer_id') === 9, 'New walk-in customer was not associated with the successful sale')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('New Walk-in Buyer')"), 'New walk-in customer was not retained in sale success')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")

  await waitFor("document.querySelectorAll('#customer-credits-test .debtor-row').length === 6", 'Customer Credits list did not load its first page')
  assert(await evaluate("document.querySelector('#customer-credits-test').textContent.includes('Customer Information') && document.querySelector('#customer-credits-test').textContent.includes('Sales History') && document.querySelector('#customer-credits-test').textContent.includes('Payment History')"), 'Customer details sections were incomplete')
  assert(await evaluate("document.querySelector('#customer-credits-test').textContent.includes('Credit Customer') && document.querySelector('#customer-credits-test').textContent.includes('09171234567') && document.querySelector('#customer-credits-test').textContent.includes('Quezon City')"), 'Customer type and contact details were incomplete')
  assert(await evaluate("document.querySelector('#customer-credits-test').textContent.includes('Partially Paid') && document.querySelector('#customer-credits-test').textContent.includes('\\u20b1300.00')"), 'Credit status or outstanding balance was inaccurate')
  await click("document.querySelector('#customer-credits-test [aria-label=\"Next customer page\"]')")
  assert(await evaluate("document.querySelectorAll('#customer-credits-test .debtor-row').length") === 2, 'Customer pagination did not show the remaining customers')
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Maria')
  assert(await evaluate("document.querySelectorAll('#customer-credits-test .debtor-row').length") === 1, 'Customer search did not filter across all customers')
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", '')
  await setSelect("document.querySelector('#customer-credits-test .customer-list-controls select')", 'Outstanding')
  assert(await evaluate("document.querySelectorAll('#customer-credits-test .debtor-row').length") === 1, 'Outstanding-balance filter was inaccurate')
  await setSelect("document.querySelector('#customer-credits-test .customer-list-controls select')", 'All')
  await capture('desktop-customer-credits.png', 1440, "document.querySelector('#customer-credits-test')")

  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '50')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  assert(await evaluate('paymentRequests.length') === 0, 'Opening Review Payment submitted the payment')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent === 'Review Payment' && document.querySelector('[role=dialog]').textContent.includes('Maria Santos') && document.querySelector('[role=dialog]').textContent.includes('OR-700')"), 'Review Payment omitted customer or credit details')
  await assertFullViewportBackdrop('Payment review backdrop')
  await capture('desktop-payment-review.png', 1440, "document.querySelector('[role=dialog]')")
  await evaluate("(() => { const button = document.querySelector('[role=dialog] .primary-action'); button.click(); button.click() })()")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Payment Recorded Successfully!'", 'Payment success modal did not open')
  await assertFullViewportBackdrop('Payment success backdrop')
  assert(await evaluate('paymentRequests.length') === 1, 'Repeated payment activation created duplicate requests')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('PAY-901') && document.querySelector('[role=dialog]').textContent.includes('\\u20b150.00') && document.querySelector('[role=dialog]').textContent.includes('\\u20b1250.00')"), 'Payment success modal omitted actual API values')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Oct 21, 2026') && document.querySelector('[role=dialog]').textContent.includes('2:45 PM')"), 'Payment success did not show the refreshed Manila timestamp')
  await capture('desktop-payment-success.png', 1440, "document.querySelector('[role=dialog]')")
  await click("document.querySelector('[role=dialog] .transaction-done-button')")
  assert(await evaluate('paymentRequests.length') === 1, 'Payment Done action resubmitted the payment')
  assert(await evaluate("document.querySelector('#customer-credits-test .balance-display').textContent.includes('\\u20b1250.00')"), 'Successful payment did not refresh the customer balance')
  assert(await evaluate("document.querySelector('#customer-credits-test .credit-stats').textContent.includes('\\u20b1250.00')"), 'Credit statistics did not remain consistent with the refreshed customer balance')

  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '60')
  await evaluate('paymentShouldFail = true')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("Boolean(document.querySelector('.payment-confirmation-modal .payment-feedback.error'))", 'Failed payment did not show an error in review')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent") === 'Review Payment', 'Failed payment incorrectly opened success')
  assert(await evaluate("document.querySelector('#customer-credits-test .payment-form input').value") === '60', 'Failed payment did not preserve the entered amount')
  await evaluate('paymentShouldFail = false')
  await click("document.querySelector('.payment-confirmation-modal .secondary-action')")

  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '250')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Payment Recorded Successfully!'", 'Full payment success modal did not open')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('PAY-903') && document.querySelector('[role=dialog]').textContent.includes('\\u20b10.00')"), 'Full payment success details were inaccurate')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")
  assert(await evaluate("document.querySelector('#customer-credits-test .payment-settled-note').textContent.includes('no unpaid credit sales')"), 'Full payment did not settle the selected credit sale')
  assert(await evaluate("document.querySelector('#customer-credits-test').textContent.includes('Paid') && document.querySelector('#customer-credits-test .balance-display').textContent.includes('\\u20b10.00')"), 'Full payment did not refresh paid status and zero customer balance')

  await click("document.querySelector('#customer-credits-test .customer-list-heading .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  assert(await evaluate("document.querySelector('[role=dialog] [role=alert]').textContent.trim()") === 'Customer name is required.', 'Add Customer required-name validation did not run')
  assert(await evaluate('customerRequests.length') === 1, 'Invalid customer form submitted a request')
  await setInput("document.querySelector('[role=dialog] input[name=customer_name]')", 'Ledger Customer')
  await evaluate("(() => { const button = document.querySelector('[role=dialog] .primary-action'); button.click(); button.click() })()")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Customer Added Successfully!'", 'Customer Credits Add Customer did not show success')
  assert(await evaluate('customerRequests.length') === 2, 'Customer Credits Add Customer submitted more than once')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")
  await waitFor("document.querySelector('#customer-credits-test .ledger-heading h2')?.textContent === 'Ledger Customer'", 'New customer did not appear without a page reload')

  await capture('mobile-customer-credits.png', 390, "document.querySelector('#customer-credits-test')")
  assert(await evaluate("document.querySelector('#customer-credits-test').scrollWidth <= document.querySelector('#customer-credits-test').clientWidth"), 'Customer Credits overflowed horizontally on mobile')

  await capture('mobile-record-sales.png', 390, "document.querySelector('#record-sales-test')")
  assert(await evaluate("document.querySelector('#record-sales-test').scrollWidth <= document.querySelector('#record-sales-test').clientWidth"), 'Record Sales overflowed horizontally on mobile')
  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Chicken Liver'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '80')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'Mobile sale success modal did not open')
  assert(await evaluate("document.querySelector('[role=dialog]').scrollWidth <= document.querySelector('[role=dialog]').clientWidth"), 'Success modal overflowed horizontally on mobile')
  await capture('mobile-sale-success.png', 390, "document.querySelector('[role=dialog]')")

  console.log('PASS product search, availability, cart quantity, removal, summaries, and responsive layout')
  console.log('PASS cash/credit confirmation, confirmed success, failure preservation, request locking, and stock refresh')
  console.log('PASS customer search, balance filtering, pagination, details, credit and payment history')
  console.log('PASS payment review, confirmed success, Manila timestamp, failure preservation, request locking, and ledger refresh')
  console.log(`SCREENSHOTS ${screenshotRoot}`)
} finally {
  browserConnection?.socket.close()
  if (browser && browser.exitCode === null) {
    browser.kill()
    await Promise.race([new Promise((resolveExit) => browser.once('exit', resolveExit)), delay(3000)])
  }
  if (vite) await vite.close()
  if (resolve(temporaryRoot).startsWith(safeTempRoot)) {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
