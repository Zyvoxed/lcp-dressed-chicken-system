import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

const assertionTracker = createAssertionTracker()
function assert(condition, message) {
  assertionTracker.check(condition, message)
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const screenshotRunRoot = await createScreenshotRunDirectory(projectRoot, 'transactions-ui')
const screenshotRoot = join(screenshotRunRoot, 'record-sales')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lcp-transactions-ui-'))
const safeTempRoot = `${resolve(tmpdir())}${sep}`
const browserPath = findBrowser()
let browserSession
let vite
let vitePort

try {
  assert(resolve(temporaryRoot).startsWith(safeTempRoot), 'Unsafe temporary test directory')
  assert(browserPath, 'Chrome is required for transaction UI tests; set CHROME_PATH to override it')

  const sourceRoot = projectRoot.replaceAll('\\', '/')
  await writeFile(join(temporaryRoot, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>')
  await writeFile(join(temporaryRoot, 'harness.jsx'), `
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthContext } from '/@fs/${sourceRoot}/src/context/AuthContext.jsx'
import { ToastProvider } from '/@fs/${sourceRoot}/src/context/ToastContext.jsx'
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
import '/@fs/${sourceRoot}/src/styles/shared/Toast.css'

const products = [
  { product_id: 1, product_name: 'Premium Whole Chicken With A Long Product Name', category: 'Whole Chicken', unit: 'kg', selling_price: '120.00', stock_quantity: '10.000', reorder_level: '2.000', status: 'Available' },
  { product_id: 2, product_name: 'Chicken Liver', category: 'Innards & Offal', unit: 'kg', selling_price: '80.00', stock_quantity: '3.000', reorder_level: '1.000', status: 'Available' },
  { product_id: 3, product_name: 'Sold Out Wings', category: 'Wings and Drumsticks', unit: 'kg', selling_price: '95.00', stock_quantity: '0.000', reorder_level: '2.000', status: 'Out of Stock' },
]
const customers = [
  { customer_id: 7, customer_name: 'Maria Santos', contact_number: '09171234567', address: 'Quezon City', current_balance: '300.00', created_at: '2026-10-01T08:00:00+08:00', is_active: true },
  { customer_id: 8, customer_name: 'Justine', contact_number: null, address: '', current_balance: '300.00', created_at: '2026-10-02T08:00:00+08:00', is_active: true },
  ...Array.from({ length: 7 }, (_, index) => ({ customer_id: 20 + index, customer_name: 'Fixture Customer ' + (index + 1), contact_number: '0900000000' + index, address: 'Test Address', current_balance: '0.00', created_at: '2026-10-03T08:00:00+08:00', is_active: true })),
]
const credits = [{ sale_id: 700, sale_date: '2026-10-20T09:30:00+08:00', total_amount: '500.00', amount_paid: '200.00', remaining_balance: '300.00', status: 'Partially Paid', recorded_by: 'Transaction Test Admin' }]
const justineCredits = [{ sale_id: 701, sale_date: '2026-10-20T11:30:00+08:00', total_amount: '300.00', amount_paid: '0.00', remaining_balance: '300.00', status: 'Unpaid', recorded_by: 'Transaction Test Admin' }]
const payments = [{ payment_id: 900, sale_id: 700, payment_amount: '100.00', remaining_balance: '300.00', payment_date: '2026-10-20T10:15:00+08:00', recorded_by: 'Transaction Test Admin' }]
const justinePayments = []
globalThis.testCredits = credits
globalThis.testJustineCredits = justineCredits
globalThis.testJustinePayments = justinePayments
globalThis.testPayments = payments
globalThis.testCustomers = customers
globalThis.salesRequests = []
globalThis.saleIdempotencyKeys = []
globalThis.paymentRequests = []
globalThis.paymentIdempotencyKeys = []
globalThis.customerRequests = []
globalThis.customerUpdateRequests = []
globalThis.productLoads = 0
globalThis.ledgerRefreshes = 0
globalThis.saleShouldFail = false
globalThis.saleShouldReject = false
globalThis.saleNetworkFail = false
globalThis.paymentShouldFail = false
globalThis.paymentShouldReject = false
globalThis.ledgerRefreshCustomerIds = []
globalThis.customerUpdateShouldFail = false
globalThis.idempotencyStatus = JSON.parse(sessionStorage.getItem('test-idempotency-status') || '{"state":"not_found"}')
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
  if (pathParts.length === 4 && pathParts[1] === 'idempotency' && method === 'GET') {
    return new Response(JSON.stringify({ success: true, data: globalThis.idempotencyStatus }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const customerId = Number(pathParts[2])
  if (pathParts.length === 3 && pathParts[1] === 'customers' && Number.isInteger(customerId) && method === 'GET') {
    const customer = customers.find((item) => item.customer_id === customerId)
    return new Response(JSON.stringify({ success: true, data: customer }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (pathParts.length === 3 && pathParts[1] === 'customers' && Number.isInteger(customerId) && method === 'PATCH') {
    const body = JSON.parse(options.body)
    globalThis.customerUpdateRequests.push({ customer_id: customerId, ...body })
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 100))
    if (globalThis.customerUpdateShouldFail) {
      return new Response(JSON.stringify({ success: false, message: 'Controlled customer update failure' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
    const customer = customers.find((item) => item.customer_id === customerId)
    if (!customer) return new Response(JSON.stringify({ success: false, message: 'Customer not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    Object.assign(customer, body)
    return new Response(JSON.stringify({ success: true, data: customer }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (pathParts.length === 4 && pathParts[1] === 'customers' && pathParts[3] === 'credits' && method === 'GET') {
    globalThis.ledgerRefreshCustomerIds.push(customerId)
    return new Response(JSON.stringify({ success: true, data: customerId === 7 ? credits : customerId === 8 ? justineCredits : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (pathParts.length === 4 && pathParts[1] === 'customers' && pathParts[3] === 'payments' && method === 'GET') {
    globalThis.ledgerRefreshCustomerIds.push(customerId)
    return new Response(JSON.stringify({ success: true, data: customerId === 7 ? payments : customerId === 8 ? justinePayments : [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (pathParts.length === 4 && pathParts[1] === 'customers' && pathParts[3] === 'sales' && method === 'GET') {
    globalThis.ledgerRefreshCustomerIds.push(customerId)
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/customers') && method === 'GET') {
    return new Response(JSON.stringify({ success: true, data: customers }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/customers/archived') && method === 'GET') {
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
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
    globalThis.saleIdempotencyKeys.push(options.headers.get('Idempotency-Key'))
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 100))
    if (globalThis.saleNetworkFail) {
      globalThis.saleNetworkFail = false
      throw new TypeError('Network response was interrupted')
    }
    if (globalThis.saleShouldFail) {
      return new Response(JSON.stringify({ success: false, message: 'Not enough stock for product 1' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    }
    if (globalThis.saleShouldReject) {
      globalThis.saleShouldReject = false
      return new Response(JSON.stringify({ success: false, code: 'TRANSACTION_REJECTED', transaction_outcome: 'not_committed', message: 'Confirmed sale rejection' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
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
    globalThis.paymentIdempotencyKeys.push(options.headers.get('Idempotency-Key'))
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 100))
    if (globalThis.paymentShouldFail) {
      return new Response(JSON.stringify({ success: false, message: 'Payment exceeds the outstanding balance' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    if (globalThis.paymentShouldReject) {
      globalThis.paymentShouldReject = false
      return new Response(JSON.stringify({ success: false, code: 'TRANSACTION_REJECTED', transaction_outcome: 'not_committed', message: 'Confirmed payment rejection' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const credit = [...credits, ...justineCredits].find((item) => item.sale_id === Number(body.sale_id))
    if (!credit || Number(body.payment_amount) > Number(credit.remaining_balance)) {
      return new Response(JSON.stringify({ success: false, message: 'Payment exceeds the outstanding balance' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
    const paymentCustomerId = credit.sale_id === 701 ? 8 : 7
    const paymentCustomer = customers.find((item) => item.customer_id === paymentCustomerId)
    const remainingBalance = (Number(credit.remaining_balance) - Number(body.payment_amount)).toFixed(2)
    credit.amount_paid = (Number(credit.amount_paid) + Number(body.payment_amount)).toFixed(2)
    credit.remaining_balance = remainingBalance
    credit.status = Number(remainingBalance) === 0 ? 'Paid' : 'Partially Paid'
    paymentCustomer.current_balance = (Number(paymentCustomer.current_balance) - Number(body.payment_amount)).toFixed(2)
    const paymentId = 900 + globalThis.paymentRequests.length
    const customerPayments = paymentCustomerId === 8 ? justinePayments : payments
    customerPayments.unshift({ payment_id: paymentId, sale_id: Number(body.sale_id), customer_id: paymentCustomerId, payment_amount: Number(body.payment_amount).toFixed(2), remaining_balance: remainingBalance, payment_date: '2026-10-21T14:45:00+08:00', recorded_by: 'Transaction Test Admin' })
    return new Response(JSON.stringify({ success: true, data: { payment_id: paymentId, sale_id: Number(body.sale_id), payment_amount: Number(body.payment_amount).toFixed(2), remaining_balance: remainingBalance, status: credit.status } }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  return new Response(JSON.stringify({ success: false, message: 'Unexpected test request' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
}

function Harness() {
  return <AuthContext.Provider value={{ user: { user_id: 1, fullname: 'Transaction Test Admin', role: 'admin' } }}>
    <MainLayout activeModule="Record Sales" role="admin" user={{ fullname: 'Transaction Test Admin' }} onSelect={() => {}} onLogout={() => {}}>
      <section id="record-sales-test"><RecordSales /></section>
      <section id="customer-credits-test"><CustomerCredits /></section>
    </MainLayout>
  </AuthContext.Provider>
}

createRoot(document.getElementById('root')).render(<ToastProvider><Harness /></ToastProvider>)
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
    server: { host: '127.0.0.1', port: 0, fs: { allow: [projectRoot, temporaryRoot] } },
  })
  await vite.listen()
  vitePort = vite.httpServer.address().port

  const pageUrl = `http://127.0.0.1:${vitePort}/`
  browserSession = await startBrowser({ browserPath, temporaryRoot, pageUrl, windowSize: null })
  await browserSession.connect()
  console.log(`[BROWSER] ${browserSession.version.Browser}; process started, DevTools discovered, WebSocket connected`)
  const browserConnection = browserSession.connection
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
    const pageText = await evaluate("({ sales: document.querySelector('#record-sales-test')?.innerText, credits: document.querySelector('#customer-credits-test')?.innerText, requests: salesRequests.length, paymentRequests: paymentRequests.length, paymentError: document.querySelector('#customer-credits-test .payment-feedback.error')?.textContent, reviewError: document.querySelector('.payment-confirmation-modal .payment-feedback.error')?.textContent, keys: saleIdempotencyKeys.length, rejectFlag: saleShouldReject })")
    throw new Error(`${message}; page: ${JSON.stringify(pageText)}`)
  }

  async function click(expression) {
    const clicked = await evaluate(`(() => { const element = ${expression}; if (!element) return false; element.click(); return true })()`)
    assert(clicked, `Could not click ${expression}`)
    await delay(50)
  }

  async function selectProduct(expression, quantity = '1') {
    await click(`${expression}.querySelector('.pos-add-product')`)
    await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Add Product Quantity\"]'))", 'Product selection did not open the quantity modal')
    await setInput("document.querySelector('#pos-quantity-entry')", quantity)
    await click("document.querySelector('[role=dialog][aria-label=\"Add Product Quantity\"] .primary-action')")
    await waitFor("!document.querySelector('[role=dialog][aria-label=\"Add Product Quantity\"]')", 'Adding a product did not close the quantity modal')
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

  await setInput("document.querySelector('#record-sales-test .pos-search-input')", 'Liver')
  assert(await evaluate("document.querySelectorAll('#record-sales-test .product-card').length") === 1, 'Product search did not filter the catalog')
  await setInput("document.querySelector('#record-sales-test .pos-search-input')", '')
  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Sold Out Wings'))")
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 0, 'Out-of-stock product was selectable')

  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken'))")
  assert(!await evaluate("document.querySelector('[role=dialog]')"), 'Clicking a product row opened quantity selection')
  await click("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken')) .querySelector('.pos-add-product')")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Add Product Quantity\"]'))", 'Product click did not open quantity selection')
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 0, 'Product was added before quantity confirmation')
  await setInput("document.querySelector('#pos-quantity-entry')", '0.001')
  await click("document.querySelector('[role=dialog][aria-label=\"Add Product Quantity\"] .primary-action')")
  await waitFor("document.querySelectorAll('#record-sales-test .basket-item').length === 1", 'Confirmed product quantity was not added')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item-quantity strong').textContent.includes('0.001 kg')"), 'Product selection did not preserve a 0.001 quantity')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item-subtotal strong').textContent.includes('0.12')"), 'Decimal product subtotal was incorrect')

  await click("document.querySelector('#record-sales-test .basket-item-edit')")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Edit Cart Quantity\"]'))", 'Cart item click did not open the edit modal')
  assert(await evaluate("document.querySelector('#pos-quantity-entry').value === '0.001'"), 'Edit modal did not preload the current quantity')
  await setInput("document.querySelector('#pos-quantity-entry')", '0.00')
  assert(await evaluate("document.querySelector('#pos-quantity-entry').value === '0.00'"), 'Deleting the last digit from 0.001 restored the previous value')
  await setInput("document.querySelector('#pos-quantity-entry')", '')
  assert(await evaluate("document.querySelector('#pos-quantity-entry').value === ''"), 'Clearing quantity did not leave the input empty')
  await setInput("document.querySelector('#pos-quantity-entry')", '0.')
  assert(await evaluate("document.querySelector('#pos-quantity-entry').value === '0.'"), 'Trailing decimal state was not preserved while editing')
  await setInput("document.querySelector('#pos-quantity-entry')", '0.5')
  assert(await evaluate("document.querySelector('#pos-quantity-entry').value === '0.5'"), 'Entering a new value after clearing failed')
  await click("document.querySelector('[role=dialog] .primary-action')")
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item-quantity strong').textContent.includes('0.5 kg')"), 'Saving a decimal edit did not update the cart quantity')

  await click("document.querySelector('#record-sales-test .basket-item-edit')")
  await setInput("document.querySelector('#pos-quantity-entry')", '0.01')
  await click("document.querySelector('[role=dialog] .primary-action')")
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item-quantity strong').textContent.includes('0.01 kg')"), 'Saving 0.01 did not preserve its precision')
  await click("document.querySelector('#record-sales-test .basket-item-edit')")
  await setInput("document.querySelector('#pos-quantity-entry')", '1.3')
  await click("document.querySelector('[role=dialog] .primary-action')")
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item-quantity strong').textContent.includes('1.3 kg')"), 'Fractional cart quantity update was incorrect')

  await selectProduct("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Chicken Liver'))")
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 2, 'Multiple products were not added')
  await click("document.querySelectorAll('#record-sales-test .basket-remove-button')[1]")
  assert(await evaluate("document.querySelectorAll('#record-sales-test .basket-item').length") === 1, 'Remove-item action did not work')
  assert(!await evaluate("document.querySelector('[role=dialog]')"), 'Trash action opened the quantity modal')

  await click("document.querySelector('#record-sales-test .basket-item-edit')")
  await setInput("document.querySelector('#pos-quantity-entry')", '-2')
  await click("document.querySelector('[role=dialog] .primary-action')")
  assert(await evaluate("Boolean(document.querySelector('[role=dialog] [role=alert]')) && document.querySelector('#pos-quantity-entry').getAttribute('aria-invalid') === 'true'"), 'Negative quantity was not rejected on save')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item-quantity strong').textContent.includes('1.3 kg')"), 'Invalid quantity changed the existing cart item')
  await click("document.querySelector('[role=dialog] .secondary-action')")
  assert(await evaluate("document.querySelector('#record-sales-test .basket-item-quantity strong').textContent.includes('1.3 kg')"), 'Canceling quantity edit changed the original quantity')
  await click("document.querySelector('#record-sales-test .basket-item-edit')")
  await setInput("document.querySelector('#pos-quantity-entry')", '1')
  await click("document.querySelector('[role=dialog] .primary-action')")
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

  await selectProduct("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '120')
  await setSelect("document.querySelector('#record-sales-test .basket-section select')", '7')
  await setSelect("document.querySelector('#record-sales-test .basket-section select')", '8')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-section select').value") === '8', 'Switching walk-in customers did not retain the latest selection')
  await evaluate('saleShouldFail = true')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Customer Information') && document.querySelector('[role=dialog]').textContent.includes('Justine')"), 'Selected customer was not shown in the sale confirmation')
  assert(!await evaluate("document.querySelector('[role=dialog]').textContent.includes('Contact number') || document.querySelector('[role=dialog]').textContent.includes('Address')"), 'Missing optional walk-in fields were not omitted')
  await evaluate("(() => { const button = document.querySelector('[role=dialog] .primary-action'); button.click(); button.click() })()")
  await waitFor("Boolean(document.querySelector('[role=dialog] .sales-feedback.error'))", 'Failed sale did not show an error')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent") === 'Confirm Sales Transaction', 'Failed sale incorrectly opened success')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-section input').value") === '120', 'Failed sale did not preserve payment input')
  assert(await evaluate('salesRequests.at(-1).customer_id') === 8, 'Selected walk-in customer was not associated with the submitted request')
  await evaluate('saleShouldFail = false')
  await click("document.querySelector('[role=dialog] .secondary-action')")
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Confirm Sales Transaction'", 'Failed sale did not remain available for retry')
  assert(await evaluate("document.querySelector('#record-sales-test .basket-section input').disabled && document.querySelector('#record-sales-test .basket-section select').disabled"), 'Pending sale inputs were not locked for safe retry')
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'Sale retry did not record the original request')
  const retriedSaleRequests = await evaluate('salesRequests.slice(-2)')
  const retriedSaleKeys = await evaluate('saleIdempotencyKeys.slice(-2)')
  assert(retriedSaleRequests.length === 2 && retriedSaleRequests[0].customer_id === retriedSaleRequests[1].customer_id && retriedSaleRequests[0].items[0].product_id === retriedSaleRequests[1].items[0].product_id, 'Sale retry changed the original submitted payload')
  assert(retriedSaleKeys.length === 2 && retriedSaleKeys[0] === retriedSaleKeys[1], 'Sale retry did not retain the original idempotency key')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")

  await selectProduct("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '120')
  await evaluate('saleShouldReject = true')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('#record-sales-test .sales-feedback.error')?.textContent.includes('confirmed not committed')", 'Confirmed sale rejection did not expose the correction action')
  await click("[...document.querySelectorAll('#record-sales-test .sales-feedback button')].find((button) => button.textContent.includes('Edit Rejected Sale'))")
  assert(await evaluate("document.querySelector('#record-sales-test .basket-section input').disabled"), 'Rejected sale unlocked before confirmation')
  await click("[...document.querySelectorAll('#record-sales-test .sales-feedback button')].find((button) => button.textContent.includes('Confirm Edit'))")
  assert(!await evaluate("document.querySelector('#record-sales-test .basket-section input').disabled"), 'Confirmed rejected sale did not unlock for editing')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'Edited rejected sale did not submit')
  const rejectedSaleKeys = await evaluate('saleIdempotencyKeys.slice(-2)')
  assert(rejectedSaleKeys.length === 2 && rejectedSaleKeys[0] !== rejectedSaleKeys[1], 'Edited rejected sale did not receive a new idempotency key')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")

  await selectProduct("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '120')
  await evaluate('saleNetworkFail = true')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('#record-sales-test .sales-feedback')?.textContent.includes('A sale submission is unresolved')", 'Network failure did not preserve an unresolved sale')
  const uncertainSaleBeforeRetry = await evaluate('({ payload: salesRequests.at(-1), key: saleIdempotencyKeys.at(-1) })')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'Network-failed sale did not retry safely')
  const uncertainSaleAfterRetry = await evaluate('({ payload: salesRequests.at(-1), key: saleIdempotencyKeys.at(-1) })')
  assert(JSON.stringify(uncertainSaleAfterRetry.payload) === JSON.stringify(uncertainSaleBeforeRetry.payload), 'Network retry changed the original sale payload')
  assert(uncertainSaleAfterRetry.key === uncertainSaleBeforeRetry.key, 'Network retry changed the original idempotency key')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")

  await selectProduct("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Premium Whole Chicken'))")
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
  await selectProduct("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Chicken Liver'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '80')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('New Walk-in Buyer') && document.querySelector('[role=dialog]').textContent.includes('09998887777') && document.querySelector('[role=dialog]').textContent.includes('Pasig City')"), 'New walk-in customer details were not shown without reloading')
  await click("document.querySelector('[role=dialog] .primary-action')")
  await waitFor("document.querySelector('[role=dialog] h2')?.textContent === 'Sale Recorded Successfully!'", 'New walk-in sale success modal did not open')
  assert(await evaluate('salesRequests.at(-1).customer_id') === 9, 'New walk-in customer was not associated with the successful sale')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('New Walk-in Buyer')"), 'New walk-in customer was not retained in sale success')
  await click("document.querySelector('[role=dialog] .transaction-done-button')")

  await waitFor("document.querySelectorAll('#customer-credits-test .customer-selection-row').length === 8", 'Customer Credits list did not load its first page')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-selection-row')].find((row) => row.textContent.includes('Maria Santos'))")
  await waitFor("document.querySelector('#customer-drawer-title')?.textContent === 'Maria Santos'", 'Customer detail drawer did not open')
  assert(await evaluate("document.querySelector('[aria-label=\"Customer information\"]') && [...document.querySelectorAll('#customer-credits-test .customer-drawer-tabs button')].some((button) => button.textContent.trim() === 'Sales History') && document.querySelector('#customer-payment-history-heading')?.textContent === 'Payment History'"), 'Customer information, sales history navigation, or payment history section was missing')
  assert(await evaluate("document.querySelectorAll('#customer-credits-test .customer-payment-history-list .initial-downpayment').length") === 1, 'Initial downpayment was missing or duplicated in payment history')
  assert(await evaluate("document.querySelector('#customer-credits-test .customer-payment-history-list').textContent.includes('Initial Downpayment') && document.querySelector('#customer-credits-test .customer-payment-history-list').textContent.includes('100.00') && document.querySelector('#customer-credits-test .customer-payment-history-list').textContent.includes('PAY-900')"), 'Initial downpayment and subsequent payment were not displayed separately')
  assert(await evaluate("document.querySelector('#customer-drawer-title')?.textContent === 'Maria Santos' && document.querySelector('[aria-label=\"Customer information\"]')?.textContent.includes('09171234567') && document.querySelector('[aria-label=\"Customer information\"]')?.textContent.includes('Quezon City')"), 'Customer identity and contact details were incomplete')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-drawer-tabs button')].find((button) => button.textContent.trim() === 'Sales History')")
  assert(await evaluate("document.querySelector('[aria-label=\"Customer balance summary\"] .outstanding strong').textContent.includes('300.00')"), 'Customer outstanding balance was inaccurate')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-drawer-tabs button')].find((button) => button.textContent.trim() === 'Record Payment')")
  await waitFor("Boolean(document.querySelector('#customer-credits-test .payment-form select option[value=\"700\"]'))", 'Unpaid credit sale was not available in the payment form')
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Maria')
  await setSelect("document.querySelector('#customer-credits-test .customer-list-controls select')", 'Outstanding')
  assert(await evaluate("document.querySelectorAll('#customer-credits-test .customer-selection-row').length") === 1, 'Customer search and outstanding-balance filter did not isolate Maria')
  assert(await evaluate("document.querySelector('#customer-credits-test').textContent.includes('OR-700') && document.querySelector('#customer-credits-test').textContent.includes('PAY-900')"), 'Customer sale and payment history were not preserved while filtering')
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", '')
  await setSelect("document.querySelector('#customer-credits-test .customer-list-controls select')", 'All')
  await click("document.querySelector('#customer-credits-test [aria-label=\"Next page\"]')")
  const paginationState = await evaluate("({ rows: document.querySelectorAll('#customer-credits-test .customer-selection-row').length, page: document.querySelector('#customer-credits-test .table-pagination strong')?.textContent, summary: document.querySelector('#customer-credits-test .table-pagination span')?.textContent })")
  assert(paginationState.rows > 0 && paginationState.page?.startsWith('2 /'), `Customer pagination did not advance to its second page: ${JSON.stringify(paginationState)}`)
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Maria')
  assert(await evaluate("document.querySelectorAll('#customer-credits-test .customer-selection-row').length") === 1, 'Customer search did not filter across all customers')
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", '')
  await setSelect("document.querySelector('#customer-credits-test .customer-list-controls select')", 'Outstanding')
  assert(await evaluate("document.querySelectorAll('#customer-credits-test .customer-selection-row').length") === 2, 'Outstanding-balance filter was inaccurate')
  await setSelect("document.querySelector('#customer-credits-test .customer-list-controls select')", 'All')
  await capture('desktop-customer-credits.png', 1440, "document.querySelector('#customer-credits-test')")

  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '50')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  assert(await evaluate('paymentRequests.length') === 0, 'Opening Review Payment submitted the payment')
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Review Payment\"]')?.textContent.includes('Maria Santos') && document.querySelector('[role=dialog][aria-label=\"Review Payment\"]')?.textContent.includes('OR-700')"), 'Review Payment omitted customer or credit details')
  await assertFullViewportBackdrop('Payment review backdrop')
  await capture('desktop-payment-review.png', 1440, "document.querySelector('[role=dialog]')")
  await evaluate("(() => { const button = document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action'); button.click(); button.click() })()")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]'))", 'Payment success modal did not open')
  await assertFullViewportBackdrop('Payment success backdrop')
  assert(await evaluate('paymentRequests.length') === 1, 'Repeated payment activation created duplicate requests')
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]').textContent.includes('PAY-901') && document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]').textContent.includes('\\u20b150.00') && document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]').textContent.includes('\\u20b1250.00')"), 'Payment success modal omitted actual API values')
  const paymentTimestampText = await evaluate("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]').textContent")
  assert(paymentTimestampText.includes('Oct 21, 2026') && paymentTimestampText.includes('2:45 PM'), `Payment success did not show the refreshed Manila timestamp: ${paymentTimestampText}`)
  await capture('desktop-payment-success.png', 1440, "document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]')")
  await click("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"] .transaction-done-button')")
  assert(await evaluate('paymentRequests.length') === 1, 'Payment Done action resubmitted the payment')
  assert(await evaluate("document.querySelector('[aria-label=\"Customer balance summary\"] .outstanding strong').textContent.includes('250.00')"), 'Successful payment did not refresh the customer balance')
  assert(await evaluate("document.querySelector('#customer-credits-test .credit-stats').textContent.includes('550.00')"), 'Credit statistics did not remain consistent with both outstanding customer balances')

  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '60')
  await evaluate('paymentShouldFail = true')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action')")
  await waitFor("Boolean(document.querySelector('.payment-confirmation-modal .payment-feedback.error'))", 'Failed payment did not show an error in review')
  assert(await evaluate("Boolean(document.querySelector('[role=dialog][aria-label=\"Review Payment\"]'))"), 'Failed payment incorrectly opened success')
  assert(await evaluate("document.querySelector('#customer-credits-test .payment-form input').value") === '60', 'Failed payment did not preserve the entered amount')
  await evaluate('paymentShouldFail = false')
  await click("document.querySelector('.payment-confirmation-modal .secondary-action')")
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action')")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]'))", 'Failed payment did not retry with its saved request')
  assert(await evaluate('paymentRequests.at(-1).payment_amount') === '60', 'Payment retry changed the original amount')
  assert(await evaluate('paymentIdempotencyKeys[1] === paymentIdempotencyKeys[2]'), 'Payment retry did not retain the original idempotency key')
  await click("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"] .transaction-done-button')")

  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '10')
  await evaluate('paymentShouldReject = true')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action')")
  await waitFor("document.querySelector('#customer-credits-test .payment-feedback.error')?.textContent.includes('confirmed not committed')", 'Confirmed payment rejection did not expose the correction action')
  await click("[...document.querySelectorAll('#customer-credits-test .payment-feedback button')].find((button) => button.textContent.includes('Edit Rejected Payment'))")
  assert(await evaluate("document.querySelector('#customer-credits-test .payment-form input').disabled"), 'Rejected payment unlocked before confirmation')
  await click("[...document.querySelectorAll('#customer-credits-test .payment-feedback button')].find((button) => button.textContent.includes('Confirm Edit'))")
  assert(!await evaluate("document.querySelector('#customer-credits-test .payment-form input').disabled"), 'Confirmed rejected payment did not unlock for editing')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '20')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action')")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]'))", 'Edited rejected payment did not submit')
  const rejectedPaymentKeys = await evaluate('paymentIdempotencyKeys.slice(-2)')
  assert(rejectedPaymentKeys.length === 2 && rejectedPaymentKeys[0] !== rejectedPaymentKeys[1], 'Edited rejected payment did not receive a new idempotency key')
  await click("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"] .transaction-done-button')")

  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '170')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action')")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]'))", 'Full payment success modal did not open')
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]').textContent.includes('PAY-906') && document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]').textContent.includes('\\u20b10.00')"), 'Full payment success details were inaccurate')
  await click("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"] .transaction-done-button')")
  assert(await evaluate("document.querySelector('#customer-credits-test .payment-settled-note').textContent.includes('fully settled their credit')"), 'Full payment did not settle the selected credit sale')
  assert(await evaluate("document.querySelector('[aria-label=\"Customer balance summary\"] .outstanding strong').textContent.includes('0.00')"), 'Full payment did not refresh the zero customer balance')

  await click("document.querySelector('#customer-credits-test .customer-list-heading .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Add Customer\"] .primary-action')")
  assert(await evaluate("document.querySelector('[role=dialog] [role=alert]').textContent.trim()") === 'Customer name is required.', 'Add Customer required-name validation did not run')
  assert(await evaluate('customerRequests.length') === 1, 'Invalid customer form submitted a request')
  await setInput("document.querySelector('[role=dialog] input[name=customer_name]')", 'Ledger Customer')
  await evaluate("(() => { const button = document.querySelector('[role=dialog] .primary-action'); button.click(); button.click() })()")
  await waitFor("document.querySelector('#customer-drawer-title')?.textContent === 'Ledger Customer'", 'Customer Credits Add Customer did not select the saved customer')
  assert(await evaluate('customerRequests.length') === 2, 'Customer Credits Add Customer submitted more than once')

  await evaluate(`(() => {
    const attempt = {
      key: 'customer-switch-payment-recovery',
      state: 'pending',
      payload: { sale_id: 700, payment_amount: '15.00' },
      display: {
        customer_id: 7,
        customer_name: 'Maria Santos',
        credit: { sale_id: 700, sale_date: '2026-10-20T09:30:00+08:00', total_amount: '500.00', amount_paid: '480.00', remaining_balance: '20.00', status: 'Partially Paid' },
      },
    }
    sessionStorage.setItem('lcp.pending-transaction.v2.1.payment', JSON.stringify({ userId: 1, attempt }))
    sessionStorage.setItem('test-idempotency-status', JSON.stringify({ state: 'not_found' }))
  })()`)
  await browserConnection.command('Page.navigate', { url: pageUrl })
  await waitFor("[...document.querySelectorAll('#customer-credits-test .customer-selection-row')].some((row) => row.textContent.includes('Maria Santos'))", 'Original customer was not listed after reload')
  await evaluate(`(() => {
    testCredits[0].remaining_balance = '20.00'
    testCredits[0].amount_paid = '480.00'
    testCredits[0].status = 'Partially Paid'
    testCustomers.find((item) => item.customer_id === 7).current_balance = '20.00'
  })()`)
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Maria Santos')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-selection-row')].find((row) => row.textContent.includes('Maria Santos'))")
  await waitFor("document.querySelector('#customer-drawer-title')?.textContent === 'Maria Santos' && document.querySelector('#customer-credits-test .payment-feedback')?.textContent.includes('No completed result was found')", 'Customer A pending payment did not remain unresolved after reload')
  await evaluate('ledgerRefreshCustomerIds = []')
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Justine')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-selection-row')].find((row) => row.textContent.includes('Justine'))")
  await waitFor("document.querySelector('#customer-drawer-title')?.textContent === 'Justine'", 'Customer switch did not open the selected ledger')
  assert(!await evaluate("document.querySelector('#customer-credits-test .payment-feedback')?.textContent.includes('Maria Santos')"), 'Maria payment recovery appeared under Justine')
  assert(await evaluate("Boolean(document.querySelector('#customer-credits-test .payment-form select option[value=\"701\"]')) && !document.querySelector('#customer-credits-test .payment-form select').disabled"), 'Justine unpaid credit sale was unavailable while Maria had a pending payment')
  assert(!await evaluate("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]')"), 'Maria payment was shown as successful under Justine')
  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '701')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '25')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action')")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]'))", 'Justine payment did not complete while Maria had a pending payment')
  assert(await evaluate("paymentRequests.at(-1).sale_id === 701 && paymentRequests.at(-1).payment_amount === '25'"), 'Justine payment request used the wrong credit sale or amount')
  assert(await evaluate("testJustinePayments[0]?.customer_id === 8 && testJustinePayments[0]?.sale_id === 701 && testJustinePayments[0]?.payment_amount === '25.00'"), 'Justine payment was not associated with her customer and selected credit sale')
  assert(await evaluate("testJustineCredits[0].remaining_balance === '275.00' && testCustomers.find((customer) => customer.customer_id === 8).current_balance === '275.00'"), 'Justine balance did not update after payment')
  await click("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"] .transaction-done-button')")
  await evaluate(`(() => {
    const attempt = {
      key: 'justine-independent-payment',
      state: 'pending',
      payload: { sale_id: 701, payment_amount: '10.00' },
      display: { customer_id: 8, customer_name: 'Justine', credit: { sale_id: 701 } },
    }
    sessionStorage.setItem('lcp.pending-transaction.v2.1.payment.8', JSON.stringify({ userId: 1, attempt }))
  })()`)
  await evaluate(`(() => {
    idempotencyStatus = {
    state: 'completed',
    status: 201,
    response: { success: true, data: { payment_id: 999, sale_id: 700, payment_amount: '15.00', remaining_balance: '5.00', status: 'Partially Paid' } },
    }
    testCredits[0].amount_paid = '495.00'
    testCredits[0].remaining_balance = '5.00'
    testCustomers.find((item) => item.customer_id === 7).current_balance = '5.00'
    testPayments.unshift({ payment_id: 999, sale_id: 700, customer_id: 7, payment_amount: '15.00', remaining_balance: '5.00', payment_date: '2026-10-21T15:00:00+08:00', recorded_by: 'Transaction Test Admin' })
  })()`)
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Maria Santos')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-selection-row')].find((row) => row.textContent.includes('Maria Santos'))")
  await waitFor("document.querySelector('#customer-drawer-title')?.textContent === 'Maria Santos'", 'Customer switch did not return to Maria ledger for payment recovery')
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]'))", 'Payment did not recover under its original customer')
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]').textContent.includes('Maria Santos')"), 'Recovered payment success used the wrong customer name')
  assert(await evaluate("ledgerRefreshCustomerIds.slice(-2).every((customerId) => customerId === 7)"), 'Payment recovery refreshed a different customer ledger')
  await click("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"] .transaction-done-button')")
  assert(await evaluate("sessionStorage.getItem('lcp.pending-transaction.v2.1.payment.7') === null"), 'Finishing Maria recovery did not clear her scoped attempt')
  assert(await evaluate("JSON.parse(sessionStorage.getItem('lcp.pending-transaction.v2.1.payment.8') || 'null')?.attempt?.key === 'justine-independent-payment'"), 'Clearing Maria recovery also cleared Justine’s independent attempt')
  await evaluate("sessionStorage.removeItem('lcp.pending-transaction.v2.1.payment.8')")
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Justine')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-selection-row')].find((row) => row.textContent.includes('Justine'))")
  await waitFor("document.querySelector('#customer-drawer-title')?.textContent === 'Justine'", 'Customer ledger did not switch before in-flight payment')
  await setInput("document.querySelector('#customer-credits-test .customer-list-controls input')", 'Maria Santos')
  await click("[...document.querySelectorAll('#customer-credits-test .customer-selection-row')].find((row) => row.textContent.includes('Maria Santos'))")
  await waitFor("Boolean(document.querySelector('#customer-credits-test .payment-form select')?.querySelector('option[value=\"700\"]'))", 'Maria ledger did not reload an open credit for the in-flight switch test')
  await setSelect("document.querySelector('#customer-credits-test .payment-form select')", '700')
  await setInput("document.querySelector('#customer-credits-test .payment-form input')", '5')
  await click("document.querySelector('#customer-credits-test .payment-form > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Review Payment\"] .primary-action')")
  await evaluate(`(() => {
    const search = document.querySelector('#customer-credits-test .customer-list-controls input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(search, 'Justine')
    search.dispatchEvent(new Event('input', { bubbles: true }))
    const row = [...document.querySelectorAll('#customer-credits-test .customer-selection-row')].find((item) => item.textContent.includes('Justine'))
    row?.click()
  })()`)
  await waitFor("document.querySelector('#customer-drawer-title')?.textContent === 'Justine'", 'Customer switching during payment did not select the new customer')
  await waitFor("ledgerRefreshCustomerIds.slice(-2).every((customerId) => customerId === 7)", 'In-flight payment did not refresh its original customer ledger')
  assert(!await evaluate("document.querySelector('[role=dialog][aria-label=\"Payment Recorded Successfully!\"]')"), 'In-flight payment result was displayed under the newly selected customer')

  await capture('mobile-customer-credits.png', 390, "document.querySelector('#customer-credits-test')")
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Customer Credits caused page-level horizontal overflow on mobile')

  await capture('mobile-record-sales.png', 390, "document.querySelector('#record-sales-test')")
  assert(await evaluate("document.querySelector('#record-sales-test').scrollWidth <= document.querySelector('#record-sales-test').clientWidth"), 'Record Sales overflowed horizontally on mobile')
  await click("[...document.querySelectorAll('#record-sales-test [role=tablist] button')].find((button) => button.textContent.includes('Products'))")
  await selectProduct("[...document.querySelectorAll('#record-sales-test .product-card')].find((card) => card.textContent.includes('Chicken Liver'))")
  await setInput("document.querySelector('#record-sales-test .basket-section input')", '80')
  await click("document.querySelector('#record-sales-test .basket-panel > .primary-action')")
  await click("document.querySelector('[role=dialog][aria-label=\"Confirm Sales Transaction\"] .primary-action')")
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"]'))", 'Mobile sale success modal did not open')
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"]').scrollWidth <= document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"]').clientWidth"), 'Success modal overflowed horizontally on mobile')
  await capture('mobile-sale-success.png', 390, "document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"]')")
  await click("document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"] .transaction-done-button')")

  await evaluate(`(() => {
    const attempt = {
      key: 'reload-sale-recovery',
      state: 'pending',
      payload: {
        customer_id: null,
        payment_type: 'Cash',
        amount_paid: '120.00',
        items: [{ product_id: 1, quantity: 1 }],
      },
      display: {
        customer_id: null,
        cart: [{
          product_id: 1,
          product_name: 'Premium Whole Chicken With A Long Product Name',
          category: 'Whole Chicken',
          unit: 'kg',
          selling_price: '120.00',
          stock_quantity: '10.000',
          quantity: 1,
        }],
      },
    }
    sessionStorage.setItem('lcp.pending-transaction.v2.1.sale', JSON.stringify({ userId: 1, attempt }))
    sessionStorage.setItem('test-idempotency-status', JSON.stringify({
      state: 'completed',
      status: 201,
      response: {
        success: true,
        data: {
          sale_id: 777,
          total_amount: '120.00',
          amount_paid: '120.00',
          remaining_balance: '0.00',
          status: 'Paid',
        },
      },
    }))
  })()`)
  await browserConnection.command('Page.navigate', { url: pageUrl })
  await waitFor("Boolean(document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"]'))", 'Reload did not recover a completed sale')
  assert(await evaluate("document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"]').textContent.includes('OR-777') && document.querySelectorAll('#record-sales-test .basket-item').length === 1"), 'Reloaded sale recovery omitted the saved transaction')
  assert(await evaluate('salesRequests.length') === 0, 'Recovered sale was submitted as a new transaction')
  await click("document.querySelector('[role=dialog][aria-label=\"Sale Recorded Successfully!\"] .transaction-done-button')")
  assert(await evaluate("sessionStorage.getItem('lcp.pending-transaction.v2.1.sale') === null"), 'Acknowledging a recovered sale did not clear its saved attempt')

  console.log('PASS product search, availability, cart quantity, removal, summaries, and responsive layout')
  console.log('PASS cash/credit confirmation, failure retry, request locking, and stock refresh')
  console.log('PASS customer search, balance filtering, pagination, details, credit and payment history')
  console.log('PASS customer editing, validation, failure preservation, duplicate prevention, refresh, and mobile layout')
  console.log('PASS payment review, failure retry, Manila timestamp, request locking, and ledger refresh')
  console.log('PASS sale completion recovery after browser reload without duplicate submission')
  console.log(`SCREENSHOTS ${screenshotRoot}`)
  console.log(`SCREENSHOT_RUN_DIRECTORY ${screenshotRunRoot}`)
} catch (error) {
  reportBrowserDiagnostics(browserSession)
  throw error
} finally {
  const counts = assertionTracker.counts
  console.log(`ASSERTIONS passed=${counts.passed} failed=${counts.failed}`)
  console.log(`SCREENSHOT_RUN_DIRECTORY ${screenshotRunRoot}`)
  const cleanupErrors = []
  try { console.log(`BROWSER_SHUTDOWN ${await cleanupBrowserSession(browserSession)}`) } catch (error) { cleanupErrors.push(error) }
  let viteStopped = !vite
  try { console.log(`VITE_SHUTDOWN ${await closeViteServer(vite)}`); viteStopped = true } catch (error) { cleanupErrors.push(error) }
  const browserStopped = !browserSession || browserSession.process.exitCode !== null || browserSession.process.signalCode !== null
  if (browserStopped && viteStopped) {
    try { await removeTemporaryRoot(temporaryRoot, safeTempRoot) } catch (error) { cleanupErrors.push(error) }
  } else {
    cleanupErrors.push(new Error(`Preserved temporary root because browser/Vite shutdown was not confirmed: ${temporaryRoot}`))
  }
  if (cleanupErrors.length) {
    for (const error of cleanupErrors) console.error(`CLEANUP_ERROR ${error.stack || error.message}`)
    process.exitCode = 1
  }
}
