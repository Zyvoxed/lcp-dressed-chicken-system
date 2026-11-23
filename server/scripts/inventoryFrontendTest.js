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
const screenshotRunRoot = await createScreenshotRunDirectory(projectRoot, 'inventory-ui')
const screenshotRoot = join(screenshotRunRoot, 'dashboard-chart')
const inventoryScreenshotRoot = join(screenshotRunRoot, 'inventory-phase5')
const analyticsScreenshotRoot = join(screenshotRunRoot, 'business-analytics-phase8')
const adminScreenshotRoot = join(screenshotRunRoot, 'admin-phase9')
const temporaryRoot = await mkdtemp(join(tmpdir(), 'lcp-inventory-ui-'))
const safeTempRoot = `${resolve(tmpdir())}${sep}`
const browserPath = findBrowser()
let browserSession
let vite
let vitePort

try {
  assert(resolve(temporaryRoot).startsWith(safeTempRoot), 'Unsafe temporary test directory')
  assert(browserPath, 'Chrome is required for the inventory UI test; set CHROME_PATH to override it')

  const sourceRoot = projectRoot.replaceAll('\\', '/')
  const categories = ['Whole Chicken', 'Prime Cuts', 'Wings and Drumsticks', 'Innards & Offal']
  const products = Array.from({ length: 17 }, (_, index) => {
    const number = index + 1
    return {
      product_id: number,
      product_name: `Product ${String(number).padStart(2, '0')}`,
      category: categories[index % categories.length],
      unit: 'kg',
      selling_price: String(100 + number),
      stock_quantity: String(number),
      reorder_level: '2.000',
      status: number % 4 === 0 ? 'Out of Stock' : number % 3 === 0 ? 'Low Stock' : 'Available',
      created_at: '2026-10-21T00:00:00.000Z',
    }
  })

  await writeFile(
    join(temporaryRoot, 'index.html'),
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/harness.jsx"></script></body></html>',
  )
  await writeFile(
    join(temporaryRoot, 'harness.jsx'),
    `import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProductList from '/@fs/${sourceRoot}/src/pages/Inventory/ProductList.jsx'
import InventoryStats from '/@fs/${sourceRoot}/src/pages/Inventory/InventoryStats.jsx'
import ProductModal from '/@fs/${sourceRoot}/src/pages/Inventory/ProductModal.jsx'
import StockInForm from '/@fs/${sourceRoot}/src/pages/Inventory/StockInForm.jsx'
import InflowRecords from '/@fs/${sourceRoot}/src/pages/Inventory/InflowRecords.jsx'
import ActivityLogs from '/@fs/${sourceRoot}/src/pages/ActivityLogs/ActivityLogs.jsx'
import BusinessAnalytics from '/@fs/${sourceRoot}/src/pages/Dashboard/BusinessAnalytics.jsx'
import UserAccounts from '/@fs/${sourceRoot}/src/pages/UserAccounts/UserAccounts.jsx'
import { AuthContext } from '/@fs/${sourceRoot}/src/context/AuthContext.jsx'
import { ToastProvider } from '/@fs/${sourceRoot}/src/context/ToastContext.jsx'
import SalesChart from '/@fs/${sourceRoot}/src/pages/Dashboard/SalesChart.jsx'
import SalesSummary from '/@fs/${sourceRoot}/src/pages/Dashboard/SalesSummary.jsx'
import TopSellingProducts from '/@fs/${sourceRoot}/src/pages/Dashboard/TopSellingProducts.jsx'
import LowSellingProducts from '/@fs/${sourceRoot}/src/pages/Dashboard/LowSellingProducts.jsx'
import RestockChecklist from '/@fs/${sourceRoot}/src/pages/Dashboard/RestockChecklist.jsx'
import RecentActivity from '/@fs/${sourceRoot}/src/pages/Dashboard/RecentActivity.jsx'
import '/@fs/${sourceRoot}/src/styles/variables.css'
import '/@fs/${sourceRoot}/src/styles/global.css'
import '/@fs/${sourceRoot}/src/styles/shared/Cards.css'
import '/@fs/${sourceRoot}/src/styles/shared/Tables.css'
import '/@fs/${sourceRoot}/src/styles/shared/Forms.css'
import '/@fs/${sourceRoot}/src/styles/shared/Shared.css'
import '/@fs/${sourceRoot}/src/styles/shared/Modal.css'
import '/@fs/${sourceRoot}/src/styles/pages/Dashboard.css'
import '/@fs/${sourceRoot}/src/styles/pages/Inventory.css'
import '/@fs/${sourceRoot}/src/styles/pages/ActivityLogs.css'
import '/@fs/${sourceRoot}/src/styles/pages/UserAccounts.css'
import '/@fs/${sourceRoot}/src/styles/shared/Toast.css'

const fixtures = ${JSON.stringify(products)}
const salesChartFixtures = [
  { sale_id: 51, sale_date: '2025-03-12T10:00:00+08:00', sale_year: 2025, sale_month: 3, product_id: 1, quantity_sold: '50.000', total_amount: '2000.00' },
  { sale_id: 52, sale_date: '2026-10-05T10:00:00+08:00', sale_year: 2026, sale_month: 10, product_id: 1, quantity_sold: '100.000', total_amount: '1000.00' },
  { sale_id: 53, sale_date: '2026-10-20T10:00:00+08:00', sale_year: 2026, sale_month: 10, product_id: 1, quantity_sold: '150.000', total_amount: '5000.00' },
]
const stockInRecords = [
  { stockin_id: 16, supplier_id: 7, supplier_name: 'Test Poultry Supplier', product_id: 3, product_name: 'Chicken Wings', unit: 'kg', user_id: 1, recorded_by: 'Inventory Admin', quantity_received: '200.000', remaining_quantity: '0.000', cost_price: '20000.00', total_cost: '4000000.00', delivery_date: '2026-09-27T17:32:00+08:00' },
  { stockin_id: 17, supplier_id: 7, supplier_name: 'Test Poultry Supplier', product_id: 3, product_name: 'Chicken Wings', unit: 'kg', user_id: 1, recorded_by: 'Inventory Admin', quantity_received: '300.000', remaining_quantity: '180.000', cost_price: '210.00', total_cost: '63000.00', delivery_date: '2026-10-21T00:25:00+08:00' },
  { stockin_id: 18, supplier_id: 7, supplier_name: 'Test Poultry Supplier', product_id: 4, product_name: 'Chicken Liver', unit: 'kg', user_id: 1, recorded_by: 'Inventory Admin', quantity_received: '100.000', remaining_quantity: '100.000', cost_price: '130.00', total_cost: '13000.00', delivery_date: '2026-10-21T00:59:00+08:00' },
]
const allocationDetails = {
  16: [
    { allocation_id: 33, sale_id: 33, salesitem_id: 29, stockin_id: 16, quantity_deducted: '110.000', cost_price: '20000.00', sale_date: '2026-10-20T18:00:00+08:00', allocation_order: 1 },
    { allocation_id: 34, sale_id: 34, salesitem_id: 30, stockin_id: 16, quantity_deducted: '90.000', cost_price: '20000.00', sale_date: '2026-10-21T01:00:00+08:00', allocation_order: 1 },
  ],
  17: [
    { allocation_id: 35, sale_id: 34, salesitem_id: 30, stockin_id: 17, quantity_deducted: '100.000', cost_price: '210.00', sale_date: '2026-10-21T01:00:00+08:00', allocation_order: 2 },
    { allocation_id: 36, sale_id: 35, salesitem_id: 31, stockin_id: 17, quantity_deducted: '20.000', cost_price: '210.00', sale_date: '2026-10-21T02:00:00+08:00', allocation_order: 1 },
  ],
  18: [],
}
const userFixtures = Array.from({ length: 10 }, (_, index) => ({
  user_id: index + 1,
  fullname: ['Zena Owner', 'Ana Staff', 'Mario Admin', 'Bea Staff', 'Carlo Staff', 'Dina Staff', 'Erik Staff', 'Faye Staff', 'Gina Staff', 'Hugo Staff'][index],
  username: 'user' + (index + 1),
  email: index === 1 ? 'ana@example.com' : null,
  email_verified_at: index === 1 ? null : '2026-10-20T10:00:00+08:00',
  contact_number: index === 1 ? '09171234567' : null,
  role: index === 0 || index === 2 ? 'Admin' : 'Staff',
  is_active: true,
  created_at: '2026-10-' + String(20 - index).padStart(2, '0') + 'T10:00:00+08:00',
  updated_at: '2026-10-' + String(20 - index).padStart(2, '0') + 'T10:00:00+08:00',
}))
const dashboardFixtures = {
  trends: {
    daily: Array.from({ length: 24 }, (_, index) => ({
      label: \`${'${String(index).padStart(2, \'0\')}'}:00\`,
      sales: index === 9 ? 5000 : index === 14 ? 780 : 0,
      transactions: index === 9 ? 2 : index === 14 ? 1 : 0,
    })),
    weekly: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, index) => ({
      label,
      sales: [1000, 2500.75, 0, 1750, 900, 3200, 1500][index],
      transactions: [1, 3, 0, 2, 1, 4, 2][index],
    })),
    monthly: Array.from({ length: 31 }, (_, index) => ({
      label: \`Oct ${'${index + 1}'}\`,
      sales: index % 5 === 0 ? 1200 + (index * 40) : index % 3 === 0 ? 650 : 0,
      transactions: index % 5 === 0 ? 2 : index % 3 === 0 ? 1 : 0,
    })),
  },
  summary: {
    total_revenue: 12345.67,
    total_transactions: 1234,
    average_sale_value: 10.005,
    best_seller: 'Extra Long Whole Chicken Product Name For Overflow Testing',
  },
  topProducts: [
    { product_id: 1, product_name: 'Whole Chicken Premium Extra Long Product Name', quantity_sold: 1234.5, unit: 'kg', sales_amount: 98765.43 },
    { product_id: 2, product_name: 'Chicken Liver', quantity_sold: 2, unit: 'kg', sales_amount: 250 },
  ],
  lowProducts: [
    { product_id: 3, product_name: 'Chicken Wings', quantity_sold: 0, stock_quantity: 12.5, unit: 'kg' },
  ],
  lowStock: [
    { product_id: 4, product_name: 'Chicken Breast', stock_quantity: 1.5, reorder_level: 3, unit: 'kg', status: 'Low Stock' },
    { product_id: 5, product_name: 'Chicken Feet', stock_quantity: 0, reorder_level: 2, unit: 'kg', status: 'Out of Stock' },
  ],
  activities: [
    { activity_id: 2, action: 'PRODUCT_UPDATED', description: 'A long but valid activity description that should remain readable without overflowing its card.', created_at: '2026-10-20T16:05:00Z', operator_name: 'Inventory Administrator', username: 'admin', fullname: 'Inventory Administrator', role: 'Admin' },
    { activity_id: 1, action: 'STOCK_IN_CREATED', description: 'Stock delivery recorded.', created_at: '2026-10-20T23:55:00+08:00', operator_name: 'Store Employee', username: 'employee', fullname: 'Store Employee', role: 'Staff' },
  ],
  business: {
    summary: {
      total_transactions: 42,
      gross_revenue: '125000.50',
      average_ticket_value: '2976.20238',
      top_seller: { product_id: 1, product_name: 'Whole Chicken Premium Extra Long Product Name', unit: 'kg', quantity_sold: '1250.500', gross_sales: '90000.50', current_stock: '30.000', reorder_level: '20.000' },
      top_sellers_by_unit: [{ product_id: 1, product_name: 'Whole Chicken Premium Extra Long Product Name', unit: 'kg' }],
    },
    product_performance: [
      { product_id: 1, product_name: 'Whole Chicken Premium Extra Long Product Name', unit: 'kg', quantity_sold: '1250.500', gross_sales: '90000.50', current_stock: '30.000', reorder_level: '20.000' },
      { product_id: 2, product_name: 'Chicken Liver', unit: 'kg', quantity_sold: '240.000', gross_sales: '24000.00', current_stock: '1.000', reorder_level: '5.000' },
      { product_id: 3, product_name: 'Chicken Wings', unit: 'kg', quantity_sold: '80.000', gross_sales: '11000.00', current_stock: '0.000', reorder_level: '8.000' },
      { product_id: 4, product_name: 'Chicken Feet', unit: 'kg', quantity_sold: '0.000', gross_sales: '0.00', current_stock: '12.000', reorder_level: '4.000' },
    ],
    top_performing: [
      { product_id: 1, product_name: 'Whole Chicken Premium Extra Long Product Name', unit: 'kg', quantity_sold: '1250.500', gross_sales: '90000.50', current_stock: '30.000', reorder_level: '20.000' },
      { product_id: 2, product_name: 'Chicken Liver', unit: 'kg', quantity_sold: '240.000', gross_sales: '24000.00', current_stock: '1.000', reorder_level: '5.000' },
    ],
    slow_selling: [
      { product_id: 4, product_name: 'Chicken Feet', unit: 'kg', quantity_sold: '0.000', gross_sales: '0.00', current_stock: '12.000', reorder_level: '4.000' },
      { product_id: 3, product_name: 'Chicken Wings', unit: 'kg', quantity_sold: '80.000', gross_sales: '11000.00', current_stock: '0.000', reorder_level: '8.000' },
    ],
    restock_alerts: [
      { product_id: 3, product_name: 'Chicken Wings', unit: 'kg', quantity_sold: '80.000', gross_sales: '11000.00', current_stock: '0.000', reorder_level: '8.000' },
      { product_id: 2, product_name: 'Chicken Liver', unit: 'kg', quantity_sold: '240.000', gross_sales: '24000.00', current_stock: '1.000', reorder_level: '5.000' },
    ],
    insights: {
      sales_driver: { product_id: 1, product_name: 'Whole Chicken Premium Extra Long Product Name', unit: 'kg', quantity_sold: '1250.500' },
      lagging_product: { product_id: 4, product_name: 'Chicken Feet', unit: 'kg', quantity_sold: '0.000' },
      procurement_priority: { product_id: 3, product_name: 'Chicken Wings', unit: 'kg', current_stock: '0.000', reorder_level: '8.000' },
    },
  },
}
globalThis.inventoryFixtures = fixtures
globalThis.inventoryDashboardFixtures = dashboardFixtures
globalThis.savedProductEvents = []
globalThis.productRequests = []
globalThis.stockInRequests = []
globalThis.stockInIdempotencyKeys = []
globalThis.stockInCreatedCount = 0
globalThis.failNextStockIn = false
globalThis.rejectNextStockIn = false
globalThis.userRequests = []
globalThis.activityRequests = []
globalThis.salesReportRequests = []
globalThis.failNextUserRequest = false
localStorage.setItem('authToken', 'inventory-ui-test-token')
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url)
  if (requestUrl.includes('/api/reports/sales')) globalThis.salesReportRequests.push(requestUrl)
  if (requestUrl.includes('/api/reports/sales')) {
    return new Response(JSON.stringify({
      success: true,
      data: {
        records: salesChartFixtures,
        pagination: { page: 1, page_size: 100, total_records: salesChartFixtures.length, total_pages: 1 },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (requestUrl.endsWith('/api/analytics/dashboard/business')) {
    return new Response(JSON.stringify({ success: true, data: dashboardFixtures.business }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (requestUrl.endsWith('/api/users') && (!options.method || options.method === 'GET')) {
    return new Response(JSON.stringify({ success: true, data: userFixtures }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const userMatch = requestUrl.match(new RegExp('/api/users/([0-9]+)(/status|/password|/email-verification)?$'))
  if (userMatch) {
    const userId = Number(userMatch[1])
    const action = userMatch[2] || 'edit'
    const body = options.body ? JSON.parse(options.body) : {}
    globalThis.userRequests.push({ userId, action, method: options.method, body })
    if (globalThis.failNextUserRequest) {
      globalThis.failNextUserRequest = false
      return new Response(JSON.stringify({ success: false, message: 'Safe account fixture failure.' }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    }
    const user = userFixtures.find((item) => item.user_id === userId)
    if (action === '/status') user.is_active = body.is_active
    return new Response(JSON.stringify({ success: true, message: action === '/password' ? 'Password reset successfully' : action === '/status' ? 'User ' + (body.is_active ? 'restored' : 'archived') + ' successfully' : 'User updated successfully', data: user }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (String(url).includes('/activity-logs')) {
    globalThis.activityRequests.push(requestUrl)
    return new Response(JSON.stringify({
      success: true,
      data: dashboardFixtures.activities,
      pagination: { page: 1, limit: 20, total: dashboardFixtures.activities.length, total_pages: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (requestUrl.endsWith('/api/products') && (!options.method || options.method === 'GET')) {
    return new Response(JSON.stringify({ success: true, data: fixtures }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (requestUrl.endsWith('/api/suppliers') && (!options.method || options.method === 'GET')) {
    return new Response(JSON.stringify({ success: true, data: [{ supplier_id: 7, supplier_name: 'Test Poultry Supplier' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (requestUrl.endsWith('/api/stock-in') && (!options.method || options.method === 'GET')) {
    return new Response(JSON.stringify({ success: true, data: stockInRecords }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const allocationMatch = requestUrl.match(new RegExp('/api/stock-in/([0-9]+)/allocations$'))
  if (allocationMatch && (!options.method || options.method === 'GET')) {
    const stockinId = Number(allocationMatch[1])
    return new Response(JSON.stringify({ success: true, data: { batch: stockInRecords.find((record) => record.stockin_id === stockinId), allocations: allocationDetails[stockinId] || [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const body = JSON.parse(options.body || '{}')
  if (requestUrl.endsWith('/api/stock-in') && options.method === 'POST') {
    globalThis.stockInRequests.push(body)
    globalThis.stockInIdempotencyKeys.push(options.headers.get('Idempotency-Key'))
    await new Promise((resolveRequest) => setTimeout(resolveRequest, 150))
    if (globalThis.rejectNextStockIn) {
      globalThis.rejectNextStockIn = false
      return new Response(JSON.stringify({ success: false, code: 'TRANSACTION_REJECTED', transaction_outcome: 'not_committed', message: 'Confirmed stock-in rejection' }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    }
    if (globalThis.failNextStockIn) {
      globalThis.failNextStockIn = false
      return new Response(JSON.stringify({ success: false, message: 'Safe fixture failure.' }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      success: true,
      data: {
        stockin_id: 41,
        supplier_id: Number(body.supplier_id),
        product_id: Number(body.product_id),
        quantity_received: Number(body.quantity_received),
        remaining_quantity: Number(body.quantity_received),
        cost_price: Number(body.cost_price),
        total_cost: Number(body.quantity_received) * Number(body.cost_price),
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  globalThis.productRequests.push({ url: String(url), method: options.method, body })
  const isEdit = options.method === 'PATCH'
  const product = isEdit ? fixtures[0] : { product_id: 99, stock_quantity: '0.000', status: 'Out of Stock' }
  return new Response(JSON.stringify({
    success: true,
    data: { ...product, ...body, unit: product.unit || body.unit, category: body.category },
  }), { status: isEdit ? 200 : 201, headers: { 'Content-Type': 'application/json' } })
}

function Harness() {
  const [products, setProducts] = useState(fixtures)
  const [modalMode, setModalMode] = useState(null)
  const [showStockIn, setShowStockIn] = useState(false)
  const [dashboardTrends, setDashboardTrends] = useState(dashboardFixtures.trends)
  globalThis.setInventoryProducts = setProducts
  globalThis.setDashboardTrends = setDashboardTrends
  return <>
    <button id="open-add-product" type="button" onClick={() => setModalMode('add')}>Open Add</button>
    <button id="open-edit-product" type="button" onClick={() => setModalMode('edit')}>Open Edit</button>
    <button id="open-stock-in" type="button" onClick={() => setShowStockIn(true)}>Open Stock In</button>
    <InventoryStats products={products} loading={false} error="" />
    <ProductList products={products} loading={false} error="" onEdit={() => {}} />
    <section id="inflow-records-test"><InflowRecords /></section>
    <section id="dashboard-test-harness" className="dashboard-page">
      <div className="dashboard-primary-grid">
        <SalesChart trends={dashboardTrends} />
        <SalesSummary summary={dashboardFixtures.summary} />
      </div>
      <div className="dashboard-two-column-grid dashboard-product-grid">
        <div className="top-products-test"><TopSellingProducts products={dashboardFixtures.topProducts} /></div>
        <LowSellingProducts products={dashboardFixtures.lowProducts} />
      </div>
      <div className="dashboard-two-column-grid dashboard-operations-grid">
        <RestockChecklist products={dashboardFixtures.lowStock} total={dashboardFixtures.lowStock.length} />
        <RecentActivity activities={dashboardFixtures.activities} />
      </div>
    </section>
    <section id="activity-logs-test"><ActivityLogs /></section>
    <section id="business-analytics-test"><BusinessAnalytics /></section>
    <AuthContext.Provider value={{ user: { user_id: 1, fullname: 'Zena Owner', username: 'user1', role: 'admin' } }}>
      <section id="user-accounts-test"><UserAccounts /></section>
    </AuthContext.Provider>
    <AuthContext.Provider value={{ user: { user_id: 1, fullname: 'Zena Owner', username: 'user1', role: 'admin' } }}>
      {showStockIn && <section id="stock-in-test"><StockInForm onCreated={() => { globalThis.stockInCreatedCount += 1 }} /></section>}
    </AuthContext.Provider>
    {modalMode && <ProductModal
      product={modalMode === 'edit' ? fixtures[0] : null}
      onClose={() => setModalMode(null)}
      onSaved={(product, mode) => {
        globalThis.savedProductEvents.push({ product, mode })
      }}
    />}
  </>
}

createRoot(document.getElementById('root')).render(<ToastProvider><Harness /></ToastProvider>)
`,
  )

  vite = await createServer({
    root: temporaryRoot,
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
    server: {
      host: '127.0.0.1',
      port: 0,
      fs: { allow: [projectRoot, temporaryRoot] },
    },
  })
  await vite.listen()
  vitePort = vite.httpServer.address().port
  const pageUrl = `http://127.0.0.1:${vitePort}`
  browserSession = await startBrowser({ browserPath, temporaryRoot, pageUrl, windowSize: null })
  await browserSession.connect()
  console.log(`[BROWSER] ${browserSession.version.Browser}; process started, DevTools discovered, WebSocket connected`)
  const browserConnection = browserSession.connection

  async function evaluate(expression) {
    let result
    try {
      result = await browserConnection.command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    } catch (error) {
      console.error(`[BROWSER EVALUATION FAILED] ${expression}`)
      throw error
    }

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed')
    }

    return result.result.value
  }

  async function waitForCondition(expression) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    const pageState = await evaluate("({ text: document.querySelector('#dashboard-test-harness .dashboard-sales-chart')?.innerText, requests: globalThis.salesReportRequests, points: document.querySelectorAll('#dashboard-test-harness .sales-overview-point').length, circles: document.querySelectorAll('#dashboard-test-harness .dashboard-sales-chart circle').length, svg: document.querySelector('#dashboard-test-harness .dashboard-sales-chart svg')?.innerHTML.slice(-1200) })")
    throw new Error(`Timed out waiting for browser condition: ${expression}; chart: ${JSON.stringify(pageState)}`)
  }

  async function waitForProducts() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await evaluate("document.querySelectorAll('.inventory-product-list tbody tr').length === 8")
      if (ready) return
      await delay(100)
    }
    const pageState = await evaluate("({ text: document.body.innerText, html: document.body.innerHTML.slice(0, 500) })")
    throw new Error(`Inventory fixture did not render: ${JSON.stringify(pageState)}`)
  }

  async function click(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await delay(100)
  }

  async function setInput(selector, value) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)})
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await delay(100)
  }

  async function setDateInput(selector, value) {
    await evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)})
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await delay(100)
  }

  async function setSelect(value, selector = '.inventory-category-filter') {
    await evaluate(`(() => {
      const select = document.querySelector(${JSON.stringify(selector)})
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
      setter.call(select, ${JSON.stringify(value)})
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await delay(100)
  }

  async function insertTextContinuously(selector, value, focusInput = true) {
    if (focusInput) {
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`)
      await delay(25)
    }

    for (const character of value) {
      await browserConnection.command('Input.insertText', { text: character })
      await delay(25)
      const inputState = await evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)})
        return {
          activeId: document.activeElement?.id,
          activeTag: document.activeElement?.tagName,
          activeLabel: document.activeElement?.getAttribute('aria-label'),
          value: input.value,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
        }
      })()`)
      assert(
        inputState.activeId === selector.slice(1),
        `${selector} lost focus while typing ${JSON.stringify(value)}: ${JSON.stringify(inputState)}`,
      )
      if (inputState.selectionStart !== null) {
        assert(inputState.selectionStart === inputState.value.length, `${selector} cursor moved while typing`)
        assert(inputState.selectionEnd === inputState.value.length, `${selector} selection changed while typing`)
      }
    }
  }

  const rowNames = () => evaluate("[...document.querySelectorAll('.inventory-product-list tbody tr')].map((row) => row.querySelector('td')?.textContent.trim())")
  const pageLabel = () => evaluate("document.querySelector('.table-pagination strong').textContent.trim()")
  const resultCount = () => evaluate("document.querySelector('.inventory-result-count').textContent.trim()")

  await waitForProducts()
  assert(JSON.stringify(await rowNames()) === JSON.stringify(products.slice(0, 8).map((product) => product.product_name)), 'Page 1 did not show the first eight products')
  assert(await pageLabel() === '1 / 3', 'The 17-product page count was not three')

  await click('[aria-label="Next page"]')
  assert(JSON.stringify(await rowNames()) === JSON.stringify(products.slice(8, 16).map((product) => product.product_name)), 'Page 2 did not show the next eight products')
  await click('[aria-label="Next page"]')
  assert(JSON.stringify(await rowNames()) === JSON.stringify([products[16].product_name]), 'Page 3 did not show the remaining product')
  await click('[aria-label="Previous page"]')
  assert(await pageLabel() === '2 / 3', 'Previous page did not return to page 2')

  await click('th:first-child button')
  await click('th:first-child button')
  assert((await rowNames())[0] === 'Product 17', 'Descending sorting did not use the complete dataset')

  await setInput('.inventory-product-controls input', 'Product 02')
  assert(JSON.stringify(await rowNames()) === JSON.stringify(['Product 02']), 'Search did not find a product outside the current page')
  assert(await pageLabel() === '1 / 1', 'Search did not reset pagination')

  await setInput('.inventory-product-controls input', '')
  for (const [category, expectedCount] of [['Whole Chicken', 5], ['Prime Cuts', 4], ['Wings & Drumsticks', 4], ['Innards & Offal', 4]]) {
    await setSelect(category)
    assert(await resultCount() === `${expectedCount} products`, `${category} filtering returned the wrong count`)
    assert(await pageLabel() === '1 / 1', `${category} filtering did not reset to page 1`)
  }

  await setSelect('Prime Cuts')
  await setInput('.inventory-product-controls input', 'Product 02')
  assert(await resultCount() === '1 product', 'Combined search and category filtering failed')
  await setInput('.inventory-product-controls input', 'No Such Product')
  assert(await evaluate("document.querySelector('.table-empty').textContent.trim()") === 'No matching records found.', 'Filtered empty state was not displayed')

  await setInput('.inventory-product-controls input', '')
  await setSelect('All')
  const initialStats = await evaluate("[...document.querySelectorAll('.stat-card > strong')].map((node) => node.textContent.trim())")
  assert(JSON.stringify(initialStats) === JSON.stringify(['17', '4', '4']), 'Initial inventory statistics were incorrect')

  await evaluate("setInventoryProducts([...inventoryFixtures, { ...inventoryFixtures[0], product_id: 18, product_name: 'Product 18', status: 'Out of Stock' }])")
  await delay(100)
  let refreshedStats = await evaluate("[...document.querySelectorAll('.stat-card > strong')].map((node) => node.textContent.trim())")
  assert(JSON.stringify(refreshedStats) === JSON.stringify(['18', '4', '5']), 'Statistics did not refresh after product creation')

  await evaluate("setInventoryProducts((items) => items.map((item) => item.product_id === 1 ? { ...item, status: 'Low Stock' } : item))")
  await delay(100)
  refreshedStats = await evaluate("[...document.querySelectorAll('.stat-card > strong')].map((node) => node.textContent.trim())")
  assert(JSON.stringify(refreshedStats) === JSON.stringify(['18', '5', '5']), 'Statistics did not refresh after product editing')

  await evaluate("setInventoryProducts((items) => items.map((item) => item.product_id === 18 ? { ...item, stock_quantity: '5.000', status: 'Available' } : item))")
  await delay(100)
  refreshedStats = await evaluate("[...document.querySelectorAll('.stat-card > strong')].map((node) => node.textContent.trim())")
  assert(JSON.stringify(refreshedStats) === JSON.stringify(['18', '5', '4']), 'Statistics did not refresh after Stock In data changed')

  await evaluate('setInventoryProducts(inventoryFixtures)')
  await delay(100)
  await click('[aria-label="Next page"]')
  await click('[aria-label="Next page"]')
  await evaluate('setInventoryProducts(inventoryFixtures.slice(0, 5))')
  await delay(100)
  assert(await pageLabel() === '1 / 1', 'Pagination did not clamp when the dataset shrank')
  assert(JSON.stringify(await rowNames()) === JSON.stringify(products.slice(0, 5).map((product) => product.product_name)), 'Clamped pagination displayed the wrong products')

  await waitForCondition("document.querySelectorAll('#dashboard-test-harness .sales-overview-point').length === 11")
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-segments button.active').textContent.trim()") === 'Monthly', 'Monthly chart period was not initially active')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-chart-header h2').textContent.includes('Sales Revenue Overview')"), 'Admin dashboard revenue chart heading changed')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-chart-header p').textContent.trim() === 'Monthly business revenue for 2026'"), 'Monthly chart subtitle did not use the selected business year')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .sales-chart-year select').value === '2026'"), 'Revenue chart did not select the latest available year')
  const curvePresentation = await evaluate(`(() => {
    const chart = document.querySelector('#dashboard-test-harness .dashboard-sales-chart')
    const line = chart.querySelector('.chart-line')
    const area = chart.querySelector('.sales-overview-area')
    const bounds = line.getBBox()
    const points = [...chart.querySelectorAll('.sales-overview-point')]
    const stops = [...chart.querySelectorAll('linearGradient stop')]
    return {
      linePath: line.getAttribute('d'),
      areaPath: area?.getAttribute('d'),
      strokeWidth: Number.parseFloat(getComputedStyle(line).strokeWidth),
      pointCount: points.length,
      nonzeroPoints: points.filter((point) => point.getAttribute('aria-label').match(/₱(?!0[.]00)/)).length,
      pathTop: bounds.y,
      pathBottom: bounds.y + bounds.height,
      gradientStops: stops.map((stop) => stop.getAttribute('stop-opacity')),
      areaPrecedesLine: Boolean(area && (area.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING)),
    }
  })()`)
  assert(curvePresentation.pointCount === 11 && curvePresentation.nonzeroPoints === 1, 'Monthly revenue chart did not retain elapsed calendar months and zero-value months')
  assert(curvePresentation.linePath.includes('C') && curvePresentation.areaPath?.startsWith(curvePresentation.linePath), 'Revenue curve or gradient area did not use the same smooth path')
  assert(curvePresentation.areaPrecedesLine && Number(curvePresentation.gradientStops[0]) > Number(curvePresentation.gradientStops.at(-1)), 'Revenue gradient did not fade beneath the curve')
  assert(curvePresentation.strokeWidth >= 2 && curvePresentation.pathTop >= 0 && curvePresentation.pathBottom <= 280, 'Revenue line geometry exceeded its chart bounds')

  await evaluate("document.querySelector('.sales-overview-point[aria-label^=\"October 2026\"]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 160, clientY: 160 }))")
  await waitForCondition("document.querySelector('.dashboard-product-sales-tooltip')?.textContent.includes('October 2026')")
  assert(await evaluate("document.querySelector('.dashboard-product-sales-tooltip').textContent.includes('Total sales revenue: ₱6,000.00')"), 'Revenue tooltip did not show the combined sale total in PHP')

  await evaluate("[...document.querySelectorAll('#dashboard-test-harness .dashboard-segments button')].find((button) => button.textContent.trim() === 'Yearly').click()")
  await waitForCondition("document.querySelectorAll('#dashboard-test-harness .sales-overview-point').length === 2")
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-chart-header p').textContent.trim() === 'Annual business revenue across recorded sales'"), 'Yearly chart subtitle did not update')
  assert(await evaluate("[...document.querySelectorAll('#dashboard-test-harness .sales-overview-point')].some((point) => point.getAttribute('aria-label').startsWith('2025:')) && [...document.querySelectorAll('#dashboard-test-harness .sales-overview-point')].some((point) => point.getAttribute('aria-label').startsWith('2026:'))"), 'Yearly chart did not group sales by calendar year')

  await evaluate("[...document.querySelectorAll('#dashboard-test-harness .dashboard-segments button')].find((button) => button.textContent.trim() === 'Monthly').click()")
  await evaluate("(() => { const year = document.querySelector('.sales-chart-year select'); year.value = '2025'; year.dispatchEvent(new Event('change', { bubbles: true })) })()")
  await waitForCondition("document.querySelector('#dashboard-test-harness .dashboard-chart-header p').textContent.includes('2025')")
  assert(await evaluate("Boolean(document.querySelectorAll('#dashboard-test-harness .sales-overview-point').length === 12 && document.querySelector('#dashboard-test-harness .sales-overview-point[aria-label^=\"March 2025\"]'))"), 'Selected-year chart did not preserve the calendar timeline')
  await evaluate("(() => { const year = document.querySelector('.sales-chart-year select'); year.value = '2026'; year.dispatchEvent(new Event('change', { bubbles: true })) })()")
  await waitForCondition("document.querySelector('#dashboard-test-harness .dashboard-chart-header p').textContent.includes('2026')")
  const summaryValues = await evaluate("[...document.querySelectorAll('#dashboard-test-harness .dashboard-summary-list strong')].map((node) => node.textContent.trim())")
  assert(summaryValues[0].includes('₱12,345.67'), 'Sales Summary did not use PHP currency formatting')
  assert(summaryValues[1] === '1,234 Invoices', 'Sales Summary transaction count was not localized')
  const topProductNames = await evaluate("[...document.querySelectorAll('#dashboard-test-harness .top-products-test .dashboard-performance-row strong')].map((node) => node.textContent.trim())")
  assert(JSON.stringify(topProductNames) === JSON.stringify(['Whole Chicken Premium Extra Long Product Name', 'Chicken Liver']), 'Top-selling product order changed')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .top-products-test .dashboard-performance-row .dashboard-performance-heading span').textContent.includes('1,234.5 kg')"), 'Product quantity formatting was incorrect')
  const stockStatuses = await evaluate("[...document.querySelectorAll('#dashboard-test-harness .dashboard-stock-row .status')].map((node) => node.textContent.trim())")
  assert(JSON.stringify(stockStatuses) === JSON.stringify(['Low Stock', 'Out of Stock']), 'Low-stock rows did not use the existing status conventions')
  const operationsPanelHeights = await evaluate(`(() => {
    const panels = document.querySelectorAll('#dashboard-test-harness .dashboard-operations-grid > .dashboard-list-panel')
    return [...panels].map((panel) => Math.round(panel.getBoundingClientRect().height))
  })()`)
  assert(operationsPanelHeights.length === 2 && operationsPanelHeights[0] === operationsPanelHeights[1], 'Low Stock Alerts and Recent Activity panels did not match heights')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-activity-row time').textContent.trim()") === 'Oct 21, 2026, 12:05 AM', 'Recent Activity did not display the Philippine timestamp')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-activity-row .dashboard-activity-operator').textContent === 'Inventory Administrator'"), 'Activity operator label was not readable')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-activity-row .dashboard-activity-action').textContent === 'PRODUCT UPDATED'"), 'Activity action was not readable in the compact list')
  assert(await evaluate("document.querySelector('#dashboard-test-harness .dashboard-activity-row .dashboard-activity-description').textContent.includes('A long but valid activity description') && document.querySelector('#dashboard-test-harness .dashboard-activity-row .dashboard-activity-role').textContent === 'Admin'"), 'Activity description or role was not retained in the compact list')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await evaluate("document.querySelectorAll('#activity-logs-test tbody tr').length === 2")) break
    await delay(50)
  }
  const activityTableTimestamps = await evaluate(`[
    ...document.querySelectorAll('#activity-logs-test tbody tr')
  ].map((row) => ({ date: row.cells[1].textContent.trim(), time: row.cells[2].textContent.trim() }))`)
  assert(activityTableTimestamps[0].date === 'Oct 21, 2026' && activityTableTimestamps[0].time === '12:05 AM', 'Activity Logs and Recent Activity formatted the same record differently')
  assert(activityTableTimestamps[1].date === 'Oct 20, 2026' && activityTableTimestamps[1].time === '11:55 PM', 'Activity Logs mishandled the pre-midnight timestamp')
  assert(await evaluate("document.querySelector('#activity-logs-test tbody tr').textContent.includes('Updated a Product')"), 'Activity Logs did not translate a known action into plain language')
  assert(await evaluate("document.querySelector('#activity-logs-test .activity-user').textContent.includes('Inventory Administrator') && document.querySelector('#activity-logs-test .activity-user').textContent.includes('@admin')"), 'Activity Logs did not identify the person and username clearly')
  const activityRequestCount = await evaluate('activityRequests.length')
  await click('#activity-logs-test .activity-filter-row button:last-child')
  assert(await evaluate("document.querySelector('#activity-logs-test .activity-date-popover') !== null"), 'Activity Logs custom date popover did not open')
  await setDateInput('#activity-logs-test .activity-date-popover label:first-child input', '2026-10-22')
  await setDateInput('#activity-logs-test .activity-date-popover label:nth-child(2) input', '2026-10-21')
  assert(await evaluate('activityRequests.length') === activityRequestCount, 'Editing custom dates triggered an unnecessary activity request')
  await click('#activity-logs-test .activity-date-actions button.active')
  assert(await evaluate("document.querySelector('#activity-logs-test .activity-date-error')?.textContent === 'Start Date cannot be later than End Date.'"), 'Invalid Activity Logs date range was not rejected')
  assert(await evaluate('activityRequests.length') === activityRequestCount, 'Invalid custom dates triggered an activity request')
  await setDateInput('#activity-logs-test .activity-date-popover label:first-child input', '2026-10-19')
  await click('#activity-logs-test .activity-date-actions button.active')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await evaluate("activityRequests.some((url) => new URL(url).searchParams.get('start_date') === '2026-10-19' && new URL(url).searchParams.get('end_date') === '2026-10-21')")) break
    await delay(50)
  }
  assert(await evaluate("activityRequests.some((url) => new URL(url).searchParams.get('start_date') === '2026-10-19' && new URL(url).searchParams.get('end_date') === '2026-10-21')"), 'Activity Logs custom date range was not sent to the API')
  assert(await evaluate("document.querySelector('#activity-logs-test .activity-date-popover') === null"), 'Applying the Activity Logs custom range did not close the popover')
  const activityBorders = await evaluate(`(() => {
    const row = document.querySelector('#activity-logs-test tbody tr')
    return [...row.cells].slice(0, -1).every((cell) => getComputedStyle(cell).borderRightWidth === '1px')
  })()`)
  assert(activityBorders, 'Activity Log vertical column separators were missing')

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate("document.querySelectorAll('#user-accounts-test tbody tr').length === 8")) break
    await delay(50)
  }
  assert(await evaluate("[...document.querySelectorAll('#user-accounts-test th')].some((cell) => cell.textContent.includes('Status'))"), 'User Accounts did not provide a clear Status column')
  assert(await evaluate("[...document.querySelectorAll('#user-accounts-test tbody tr')].every((row) => row.querySelector('.status.active')?.textContent.trim() === 'Active')"), 'Active account status was not readable')
  assert(await evaluate("document.querySelector('#user-accounts-test .table-pagination').textContent.includes('1 / 2')"), 'User Account pagination did not include every account')
  await evaluate("[...document.querySelectorAll('#user-accounts-test th button')].find((button) => button.textContent.includes('Full Name')).click()")
  await delay(50)
  assert(await evaluate("document.querySelector('#user-accounts-test .user-identity strong').textContent.trim()") === 'Ana Staff', 'Full Name sorting used the wrong account field')
  const anaRowSelector = `(() => [...document.querySelectorAll('#user-accounts-test tbody tr')].find((row) => row.textContent.includes('Ana Staff')))`
  const beaRowSelector = `(() => [...document.querySelectorAll('#user-accounts-test tbody tr')].find((row) => row.textContent.includes('Bea Staff')))`
  await evaluate(`${beaRowSelector}().querySelector('.table-action.danger').click()`)
  assert(await evaluate("document.querySelector('.user-confirmation-modal').textContent.includes('Bea Staff')"), 'Archive confirmation did not identify the affected account')
  assert(await evaluate("document.activeElement?.getAttribute('aria-label') === 'Close modal'"), 'Account confirmation did not use shared modal focus behavior')
  await click('.user-confirmation-modal .secondary-action')
  assert(!await evaluate("Boolean(document.querySelector('.user-confirmation-modal'))"), 'Cancel did not close the account confirmation')
  await evaluate(`${beaRowSelector}().querySelector('.table-action.danger').click(); failNextUserRequest = true`)
  await click('.user-confirmation-modal .primary-action')
  await waitForCondition("document.querySelector('.user-confirmation-modal [role=alert]')?.textContent.includes('Safe account fixture failure.')")
  assert(await evaluate("Boolean(document.querySelector('.user-confirmation-modal'))"), 'Failed account archive closed its confirmation')
  const statusRequestCount = await evaluate("userRequests.filter((request) => request.action === '/status').length")
  await evaluate("document.querySelector('.user-confirmation-modal .primary-action').click(); document.querySelector('.user-confirmation-modal .primary-action').click()")
  await waitForCondition("!document.querySelector('.user-confirmation-modal')")
  assert(await evaluate("userRequests.filter((request) => request.action === '/status').length") === statusRequestCount + 1, 'Account archive duplicate-submit lock did not enforce one request')
  assert(await evaluate("document.querySelector('.toast-viewport .system-toast.success').textContent.includes('archived')"), 'Successful account archive did not show a success toast')

  await evaluate(`${anaRowSelector}().querySelectorAll('.table-action')[1].click()`)
  await setInput('#user-accounts-test #user-password', 'NewSecurePassword1!')
  const passwordInputs = await evaluate("document.querySelectorAll('#user-accounts-test .profile-panel input[autocomplete=new-password]').length")
  assert(passwordInputs === 2, 'Password reset form did not retain both password fields')
  await setInput('#user-accounts-test #user-confirm-password', 'NewSecurePassword1!')
  const passwordRequestCount = await evaluate("userRequests.filter((request) => request.action === '/password').length")
  await click('#user-accounts-test .profile-panel form .primary-action')
  assert(await evaluate("document.querySelector('.user-confirmation-modal').textContent.includes('Ana Staff')"), 'Password reset confirmation did not identify the affected account')
  assert(await evaluate(`userRequests.filter((request) => request.action === '/password').length`) === passwordRequestCount, 'Password reset was submitted before confirmation')
  await evaluate('failNextUserRequest = true')
  await click('.user-confirmation-modal .primary-action')
  await waitForCondition("document.querySelector('.user-confirmation-modal [role=alert]')?.textContent.includes('Safe account fixture failure.')")
  assert(await evaluate("document.querySelector('#user-accounts-test #user-password').value === 'NewSecurePassword1!'"), 'Failed password reset did not preserve the entered password')
  const successfulPasswordRequestCount = await evaluate("userRequests.filter((request) => request.action === '/password').length")
  await evaluate("document.querySelector('.user-confirmation-modal .primary-action').click(); document.querySelector('.user-confirmation-modal .primary-action').click()")
  await waitForCondition("!document.querySelector('.user-confirmation-modal')")
  assert(await evaluate("userRequests.filter((request) => request.action === '/password').length") === successfulPasswordRequestCount + 1, 'Password reset duplicate-submit lock did not enforce one request')
  await waitForCondition("document.querySelector('.toast-viewport .system-toast.success')?.textContent.includes('Password reset successfully')")

  await click('#user-accounts-test [aria-label="Next page"]')
  assert(await evaluate("document.querySelector('#user-accounts-test .table-pagination').textContent.includes('2 / 2')"), 'User Account next-page navigation failed')
  await click('#user-accounts-test [aria-label="Previous page"]')
  await setInput('#user-accounts-test .user-registry-search input', 'Ana Staff')
  await delay(100)
  assert(await evaluate("document.querySelectorAll('#user-accounts-test tbody tr').length === 1 && document.querySelector('#user-accounts-test tbody tr').textContent.includes('Ana Staff')"), 'User Account search did not filter the account list')
  await setInput('#user-accounts-test .user-registry-search input', '')
  await click('#user-accounts-test .user-role-filter button:nth-child(2)')
  assert(await evaluate("[...document.querySelectorAll('#user-accounts-test tbody tr')].every((row) => row.textContent.includes('Admin'))"), 'User Account role filter returned the wrong roles')
  await click('#user-accounts-test .user-role-filter button:first-child')
  const userBorders = await evaluate(`(() => {
    const row = document.querySelector('#user-accounts-test tbody tr')
    return [...row.cells].slice(0, -1).every((cell) => getComputedStyle(cell).borderRightWidth === '1px')
  })()`)
  assert(userBorders, 'User Account vertical column separators were missing')
  await mkdir(adminScreenshotRoot, { recursive: true })
  await evaluate("document.querySelector('#user-accounts-test').scrollIntoView({ block: 'start' })")
  await delay(100)
  let adminScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(adminScreenshotRoot, 'desktop-user-accounts.png'), adminScreenshot.data, 'base64')

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate("Boolean(document.querySelector('#business-analytics-test .business-kpi-grid'))")) break
    await delay(50)
  }
  assert(!await evaluate("Boolean(document.querySelector('#business-analytics-test .analytics-context-row'))"), 'Redundant Business Analytics introduction was not removed')
  const analyticsKpis = await evaluate("[...document.querySelectorAll('#business-analytics-test .business-kpi-grid article > strong')].map((node) => node.textContent.trim())")
  assert(analyticsKpis[0] === '42' && analyticsKpis[1].includes('125,000.50') && analyticsKpis[2].includes('2,976.20'), 'Business Analytics KPI formatting changed the source values')
  assert(analyticsKpis[3] === 'Whole Chicken Premium Extra Long Product Name', 'Business Analytics top seller changed')
  const productTrendPointCount = await evaluate("document.querySelectorAll('#business-analytics-test .product-trends-point').length")
  const productTrendState = await evaluate("document.querySelector('#business-analytics-test .product-trends-empty-state, #business-analytics-test [role=alert], #business-analytics-test .product-trends-loading-state')?.textContent.trim() || 'chart rendered'")
  assert(productTrendPointCount === 11, `Product chart did not render the elapsed-month calendar timeline (points=${productTrendPointCount}; state=${productTrendState})`)
  const firstAnalyticsPointLabel = await evaluate("document.querySelector('#business-analytics-test .product-trends-point').getAttribute('aria-label')")
  assert(firstAnalyticsPointLabel.includes('2026') && firstAnalyticsPointLabel.includes('kg'), 'Product chart point did not expose its period and quantity accessibly')
  const analyticsRanks = await evaluate("[...document.querySelectorAll('#business-analytics-test .analytics-performance-list.top .analytics-performance-row strong')].map((node) => node.textContent.trim())")
  assert(JSON.stringify(analyticsRanks) === JSON.stringify(['Whole Chicken Premium Extra Long Product Name', 'Chicken Liver']), 'Top-performing product ranking order changed')
  assert(await evaluate("document.querySelector('#business-analytics-test .analytics-restock-panel').textContent.includes('0 kg') && document.querySelector('#business-analytics-test .analytics-restock-panel').textContent.includes('Reorder at: 8 kg')"), 'Restock analytics did not show actual stock and reorder values')
  assert(await evaluate("document.querySelector('#business-analytics-test .analytics-performance-list.top h2').textContent.includes('PRODUCTS SELLING MOST') && document.querySelector('#business-analytics-test .analytics-performance-list.slow h2').textContent.includes('PRODUCTS SELLING LEAST')"), 'Product ranking labels were not simplified')
  await mkdir(analyticsScreenshotRoot, { recursive: true })
  await evaluate("document.querySelector('#business-analytics-test').scrollIntoView({ block: 'start' })")
  await delay(100)
  let analyticsScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(analyticsScreenshotRoot, 'desktop-business-analytics.png'), analyticsScreenshot.data, 'base64')

  await evaluate("[...document.querySelectorAll('#dashboard-test-harness .dashboard-segments button')].find((button) => button.textContent.trim() === 'Monthly').click()")
  await delay(100)

  async function measureDashboardChart(viewportWidth) {
    await browserConnection.command('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await delay(150)
    return evaluate(`(() => {
      const card = document.querySelector('#dashboard-test-harness .dashboard-sales-chart')
      const canvas = card.querySelector('.chart-canvas')
      const svg = card.querySelector('.line-chart')
      const line = svg.querySelector('.chart-line')
      const matrix = svg.getScreenCTM()
      return {
        viewportWidth: ${viewportWidth},
        cardWidth: card.getBoundingClientRect().width,
        canvasWidth: canvas.getBoundingClientRect().width,
        svgWidth: svg.getBoundingClientRect().width,
        svgHeight: svg.getBoundingClientRect().height,
        viewBoxWidth: svg.viewBox.baseVal.width,
        plotWidth: (svg.viewBox.baseVal.width - 90) * matrix.a,
        verticalUtilization: line.getBBox().height / (310 - 24 - 48),
      }
    })()`)
  }

  const chartMeasurements = []
  for (const viewportWidth of [1440, 900, 600]) {
    chartMeasurements.push(await measureDashboardChart(viewportWidth))
  }
  for (const measurement of chartMeasurements) {
    assert(Math.abs(measurement.viewBoxWidth - measurement.canvasWidth) <= 1, `Chart viewBox did not track its ${measurement.viewportWidth}px container`)
    assert(measurement.svgWidth <= measurement.canvasWidth + 1, `Chart overflowed at ${measurement.viewportWidth}px`)
    assert(measurement.svgHeight >= 280 && measurement.svgHeight <= 340, `Chart height was unbalanced at ${measurement.viewportWidth}px`)
    assert(measurement.verticalUtilization >= 0.75, `Monthly sales line was vertically compressed at ${measurement.viewportWidth}px`)
  }
  for (const measurement of chartMeasurements.slice(0, 2)) {
    const plotRatio = measurement.plotWidth / measurement.canvasWidth
    assert(plotRatio >= 0.85 && plotRatio <= 0.95, `Desktop/tablet plot width was unexpectedly narrow at ${measurement.viewportWidth}px`)
  }
  assert(chartMeasurements[2].plotWidth / chartMeasurements[2].canvasWidth >= 0.8, 'Mobile plot width was unexpectedly narrow')
  console.log(`CHART_MEASUREMENTS ${JSON.stringify(chartMeasurements)}`)

  async function captureChartScreenshot(fileName, viewportWidth, period) {
    await browserConnection.command('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await evaluate(`[
      ...document.querySelectorAll('#dashboard-test-harness .dashboard-segments button')
    ].find((button) => button.textContent.trim() === ${JSON.stringify(period)}).click()`)
    await evaluate("document.querySelector('#dashboard-test-harness .dashboard-sales-chart').scrollIntoView({ block: 'start' })")
    await delay(150)
    const screenshot = await browserConnection.command('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    await writeFile(join(screenshotRoot, fileName), screenshot.data, 'base64')
  }

  await mkdir(screenshotRoot, { recursive: true })
  await captureChartScreenshot('desktop-monthly.png', 1440, 'Monthly')
  await captureChartScreenshot('desktop-yearly.png', 1440, 'Yearly')
  await captureChartScreenshot('desktop-monthly-tablet.png', 900, 'Monthly')
  await captureChartScreenshot('tablet-yearly.png', 900, 'Yearly')
  await captureChartScreenshot('mobile-monthly.png', 600, 'Monthly')

  await browserConnection.command('Emulation.setDeviceMetricsOverride', {
    width: 600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await delay(150)
  const mobileGridColumns = await evaluate("getComputedStyle(document.querySelector('#dashboard-test-harness .dashboard-product-grid')).gridTemplateColumns")
  assert(!mobileGridColumns.includes(' '), 'Dashboard product cards did not stack at mobile width')
  assert(await evaluate("document.querySelector('#dashboard-test-harness').scrollWidth <= document.querySelector('#dashboard-test-harness').clientWidth"), 'Dashboard cards overflowed horizontally at mobile width')
  assert(await evaluate("document.querySelector('#activity-logs-test').scrollWidth <= document.querySelector('#activity-logs-test').clientWidth"), 'Activity Logs page overflowed horizontally at mobile width')
  assert(await evaluate("document.querySelector('#activity-logs-test .activity-table-scroll').scrollWidth > document.querySelector('#activity-logs-test .activity-table-scroll').clientWidth"), 'Activity Logs table did not preserve its mobile scroll region')
  await evaluate("document.querySelector('#activity-logs-test').scrollIntoView({ block: 'start' })")
  await delay(100)
  adminScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(adminScreenshotRoot, 'mobile-activity-logs.png'), adminScreenshot.data, 'base64')
  await evaluate("document.querySelector('#user-accounts-test').scrollIntoView({ block: 'start' })")
  await delay(100)
  assert(await evaluate("document.querySelector('#user-accounts-test').scrollWidth <= document.querySelector('#user-accounts-test').clientWidth"), 'User Accounts overflowed the mobile viewport')
  assert(await evaluate("document.querySelector('#user-accounts-test .table-scroll').scrollWidth > document.querySelector('#user-accounts-test .table-scroll').clientWidth"), 'User Account table did not preserve contained horizontal scrolling')
  adminScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(adminScreenshotRoot, 'mobile-user-accounts.png'), adminScreenshot.data, 'base64')
  await evaluate("document.querySelector('#business-analytics-test').scrollIntoView({ block: 'start' })")
  await delay(100)
  assert(await evaluate("document.querySelector('#business-analytics-test').scrollWidth <= document.querySelector('#business-analytics-test').clientWidth"), 'Business Analytics overflowed the mobile viewport')
  assert(await evaluate("getComputedStyle(document.querySelector('#business-analytics-test .business-kpi-grid')).gridTemplateColumns.split(' ').length === 1"), 'Business Analytics KPI cards did not stack on mobile')
  analyticsScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(analyticsScreenshotRoot, 'mobile-business-analytics.png'), analyticsScreenshot.data, 'base64')
  await browserConnection.command('Emulation.clearDeviceMetricsOverride')
  await delay(100)

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate("document.querySelectorAll('#inflow-records-test tbody tr').length === 3")) break
    await delay(50)
  }
  assert(await evaluate("document.querySelector('#inflow-records-test').textContent.includes('DLV-16') && document.querySelector('#inflow-records-test').textContent.includes('DLV-17')"), 'Inflow Records did not display the verified FIFO batches')
  assert(await evaluate("document.querySelector('#inflow-records-test').textContent.includes('Used Up') && document.querySelector('#inflow-records-test').textContent.includes('Partially Used') && document.querySelector('#inflow-records-test').textContent.includes('Available')"), 'Inflow Records did not distinguish all batch usage states in plain language')
  assert(!await evaluate("document.querySelector('#inflow-records-test .inventory-inflow-heading').textContent.includes('The system automatically uses stock from older deliveries before newer deliveries.')"), 'Inflow Records still shows the removed description below its heading')
  assert(await evaluate(`(() => {
    const rows = [...document.querySelectorAll('#inflow-records-test tbody tr')]
    const batch16 = rows.find((row) => row.textContent.includes('DLV-16'))?.textContent || ''
    const batch17 = rows.find((row) => row.textContent.includes('DLV-17'))?.textContent || ''
    return batch16.includes('200 kg') && batch16.includes('0 kg') && batch17.includes('300 kg') && batch17.includes('180 kg') && batch17.includes('120 kg')
  })()`), 'Received, remaining, or consumed FIFO quantities were inaccurate')

  await click('tr[aria-label="Open delivery details for DLV-16"]')
  await waitForCondition("Boolean(document.querySelector('.fifo-allocation-list'))")
  assert(await evaluate("document.querySelector('.fifo-batch-modal').textContent.includes('Used Up') && document.querySelector('.fifo-batch-modal').textContent.includes('200 kg')"), 'Batch 16 summary did not show its used-up balance')
  assert(await evaluate("document.querySelector('.fifo-batch-modal').textContent.includes('The system automatically uses stock from older deliveries before newer deliveries.')"), 'Batch details omitted the FIFO explanation')
  assert(await evaluate(`(() => {
    const sale = [...document.querySelectorAll('.fifo-allocation-list article')].find((article) => article.textContent.includes('Sale Reference: OR-34'))
    return Boolean(sale && sale.textContent.includes('90 kg') && sale.textContent.includes('Quantity Used') && !sale.textContent.includes('Allocation order'))
  })()`), 'Batch 16 did not show the verified Sale 34 quantity in plain language')
  assert(await evaluate("document.activeElement?.getAttribute('aria-label') === 'Close modal'"), 'FIFO batch modal did not use shared modal focus behavior')
  const fifoBackdrop = await evaluate(`(() => { const rect = document.querySelector('.modal-backdrop').getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight } })()`)
  assert(fifoBackdrop.left === 0 && fifoBackdrop.top === 0 && fifoBackdrop.width === fifoBackdrop.viewportWidth && fifoBackdrop.height === fifoBackdrop.viewportHeight, `FIFO batch backdrop did not cover the viewport (${JSON.stringify(fifoBackdrop)})`)
  await mkdir(inventoryScreenshotRoot, { recursive: true })
  let fifoScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(inventoryScreenshotRoot, 'desktop-fifo-batch-16.png'), fifoScreenshot.data, 'base64')
  await click('.fifo-batch-modal > .primary-action')

  await click('tr[aria-label="Open delivery details for DLV-17"]')
  await waitForCondition("Boolean(document.querySelector('.fifo-allocation-list'))")
  assert(await evaluate("document.querySelector('.fifo-batch-modal').textContent.includes('Partially Used') && document.querySelector('.fifo-batch-modal').textContent.includes('180 kg') && document.querySelector('.fifo-batch-modal').textContent.includes('120 kg')"), 'Batch 17 summary did not show its verified remaining balance')
  assert(await evaluate(`(() => {
    const sale = [...document.querySelectorAll('.fifo-allocation-list article')].find((article) => article.textContent.includes('Sale Reference: OR-34'))
    return Boolean(sale && sale.textContent.includes('100 kg') && sale.textContent.includes('Quantity Used') && !sale.textContent.includes('Allocation order'))
  })()`), 'Batch 17 did not show the verified Sale 34 quantity without technical allocation order')
  fifoScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(inventoryScreenshotRoot, 'desktop-fifo-batch-17.png'), fifoScreenshot.data, 'base64')
  await click('.fifo-batch-modal > .primary-action')

  await click('tr[aria-label="Open delivery details for DLV-18"]')
  await waitForCondition("document.querySelector('.fifo-batch-modal')?.textContent.includes('No sales have used stock from this delivery.')")
  assert(await evaluate("document.querySelector('.fifo-batch-modal').textContent.includes('Available') && document.querySelector('.fifo-batch-modal').textContent.includes('100 kg')"), 'Available batch empty allocation state was inaccurate')
  await click('.fifo-batch-modal > .primary-action')

  await click('#open-add-product')
  assert(await evaluate("document.activeElement?.getAttribute('aria-label')") === 'Close modal', 'Modal did not preserve its existing initial focus behavior')
  await insertTextContinuously('#product-name', 'Chicken Liver')
  assert(await evaluate("document.querySelector('#product-name').value") === 'Chicken Liver', 'Product Name did not retain the complete typed value')
  await insertTextContinuously('#product-unit', 'kg')
  await setSelect('Whole Chicken', '#product-category')
  await insertTextContinuously('#product-selling-price', '125.50')
  await insertTextContinuously('#product-reorder-level', '2.500')
  assert(await evaluate("Boolean(document.querySelector('[role=dialog]'))"), 'Modal closed while typing')

  await evaluate("document.querySelector('#product-name').focus()")
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await delay(50)
  assert(await evaluate('document.activeElement?.id') === 'product-category', 'Normal Tab navigation did not reach Category')

  await click('.modal-actions .primary-action')
  await delay(150)
  assert(await evaluate("savedProductEvents.at(-1)?.mode") === 'create', 'Add Product submission did not complete')
  assert(await evaluate("productRequests.at(-1)?.body.product_name") === 'Chicken Liver', 'Add Product submitted the wrong controlled value')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent.trim()") === 'Product Added Successfully!', 'Add Product did not show backend-confirmed success')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('Chicken Liver')"), 'Add Product success omitted the saved product details')
  await click('.transaction-done-button')

  await click('#open-edit-product')
  await evaluate("document.querySelector('#product-name').select()")
  await insertTextContinuously('#product-name', 'Edited Chicken', false)
  assert(await evaluate("document.querySelector('#product-name').value") === 'Edited Chicken', 'Edit Product name did not retain continuous typing')
  await click('.modal-actions .primary-action')
  await delay(150)
  assert(await evaluate("savedProductEvents.at(-1)?.mode") === 'edit', 'Edit Product submission did not complete')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent.trim()") === 'Product Updated Successfully!', 'Edit Product did not show backend-confirmed success')
  await click('.transaction-done-button')

  await click('#open-add-product')
  await click('.close-button')
  assert(!await evaluate("Boolean(document.querySelector('[role=dialog]'))"), 'X did not close the modal when activated')
  await click('#open-add-product')
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await browserConnection.command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await delay(50)
  assert(!await evaluate("Boolean(document.querySelector('[role=dialog]'))"), 'Escape did not close the modal')
  await click('#open-add-product')
  await click('.modal-actions .secondary-action')
  assert(!await evaluate("Boolean(document.querySelector('[role=dialog]'))"), 'Cancel did not close the modal')

  await click('#open-stock-in')
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await evaluate("document.querySelector('#stock-in-test select[name=product_id]')?.options.length === 18")) break
    await delay(50)
  }
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  assert(await evaluate("document.querySelector('#stock-in-test [role=alert]').textContent.trim()") === 'Select a supplier.', 'Stock In required-field validation did not run')
  await setSelect('7', '#stock-in-test select[name=supplier_id]')
  await setSelect('1', '#stock-in-test select[name=product_id]')
  await setInput('#stock-in-test input[name=quantity_received]', '5.5')
  await setInput('#stock-in-test input[name=cost_price]', '60')
  assert(await evaluate("document.querySelector('#stock-in-test .selected-stock-summary').textContent.includes('1 kg')"), 'Selected product current stock and unit were not displayed')
  const stockInDates = await evaluate(`(() => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
    const today = [values.year, String(values.month).padStart(2, '0'), String(values.day).padStart(2, '0')].join('-')
    const tomorrowDate = new Date(Date.UTC(values.year, values.month - 1, values.day + 1))
    return { today, tomorrow: tomorrowDate.toISOString().slice(0, 10) }
  })()`)
  assert(await evaluate("document.querySelector('#stock-in-test input[name=delivery_date]').max") === `${stockInDates.today}T23:59`, 'Stock In date picker maximum was not today in Manila time')
  await setInput('#stock-in-test input[name=delivery_date]', `${stockInDates.tomorrow}T10:00`)
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  assert(await evaluate("document.querySelector('#stock-in-test [role=alert]').textContent.trim()") === 'Future stock-in dates are not allowed. Please select today or a previous date.', 'Manually entered future Stock In date was not rejected')
  assert(await evaluate('stockInRequests.length') === 0, 'Future Stock In date reached the API')
  await setInput('#stock-in-test input[name=delivery_date]', `${stockInDates.today}T10:00`)
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  assert(await evaluate('stockInRequests.length') === 0, 'Stock In was committed before review confirmation')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent.trim()") === 'Review Stock Delivery', 'Stock In review modal did not open')
  const backdropCoverage = await evaluate(`(() => {
    const rect = document.querySelector('.modal-backdrop').getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, viewportWidth: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight }
  })()`)
  assert(backdropCoverage.left === 0 && backdropCoverage.top === 0, 'Stock In modal backdrop did not start at the viewport origin')
  assert(backdropCoverage.width === backdropCoverage.viewportWidth && backdropCoverage.height === backdropCoverage.viewportHeight, 'Stock In modal backdrop did not cover the viewport')
  await mkdir(inventoryScreenshotRoot, { recursive: true })
  let inventoryScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(inventoryScreenshotRoot, 'desktop-stock-in-review.png'), inventoryScreenshot.data, 'base64')
  await click('.inventory-confirmation-modal .secondary-action')
  assert(await evaluate("document.querySelector('#stock-in-test input[name=quantity_received]').value") === '5.5', 'Returning from Stock In review did not preserve the quantity')
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  await evaluate("document.querySelector('.inventory-confirmation-modal .primary-action').click(); document.querySelector('.inventory-confirmation-modal .primary-action').click()")
  await delay(350)
  assert(await evaluate('stockInRequests.length') === 1, 'Stock In duplicate-submit lock did not enforce one request')
  assert(await evaluate('stockInCreatedCount') === 1, 'Stock In success did not trigger the inventory refresh callback')
  assert(await evaluate("document.querySelector('[role=dialog] h2').textContent.trim()") === 'Stock In Recorded Successfully!', 'Stock In did not show backend-confirmed success')
  assert(await evaluate("document.querySelector('[role=dialog]').textContent.includes('DLV-41') && document.querySelector('[role=dialog]').textContent.includes('Product 01')"), 'Stock In success omitted actual response details')
  inventoryScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(inventoryScreenshotRoot, 'desktop-stock-in-success.png'), inventoryScreenshot.data, 'base64')
  await click('.transaction-done-button')
  assert(await evaluate("document.querySelector('#stock-in-test input[name=quantity_received]').value") === '', 'Successful Stock In did not reset the quantity after acknowledgement')

  await setInput('#stock-in-test input[name=quantity_received]', '2')
  await setInput('#stock-in-test input[name=cost_price]', '55')
  await evaluate('failNextStockIn = true')
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  await click('.inventory-confirmation-modal .primary-action')
  await delay(250)
  assert(await evaluate("document.querySelector('.inventory-confirmation-modal [role=alert]').textContent.trim()") === 'Safe fixture failure.', 'Failed Stock In did not show the API error in the review modal')
  assert(await evaluate("document.querySelector('#stock-in-test input[name=quantity_received]').value") === '2', 'Failed Stock In did not preserve the quantity')
  assert(!await evaluate("document.querySelector('[role=dialog] h2').textContent.includes('Successfully')"), 'Failed Stock In incorrectly showed success')
  await click('.inventory-confirmation-modal .secondary-action')
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  await click('.inventory-confirmation-modal .primary-action')
  await waitForCondition("document.querySelector('[role=dialog] h2')?.textContent.includes('Stock In Recorded Successfully')")
  assert(await evaluate('stockInIdempotencyKeys[1] === stockInIdempotencyKeys[2]'), 'Ambiguous stock-in retry did not retain the original idempotency key')
  await click('.transaction-done-button')
  await setInput('#stock-in-test input[name=quantity_received]', '3')
  await setInput('#stock-in-test input[name=cost_price]', '55')
  await evaluate('rejectNextStockIn = true')
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  await click('.inventory-confirmation-modal .primary-action')
  await waitForCondition("document.querySelector('#stock-in-test .inventory-feedback[role=status]')?.textContent.includes('confirmed not committed')")
  const rejectedStockFeedback = await evaluate("document.querySelector('#stock-in-test .inventory-feedback[role=status]')?.innerText")
  const editRejectedStockButton = await evaluate("[...document.querySelectorAll('#stock-in-test .inventory-feedback[role=status] button')].some((button) => button.textContent.includes('Edit Rejected Delivery'))")
  assert(editRejectedStockButton, `Rejected stock-in correction button is missing: ${rejectedStockFeedback}`)
  await click('#stock-in-test .inventory-feedback[role=status] button')
  assert(await evaluate("document.querySelector('#stock-in-test input[name=quantity_received]').disabled"), 'Rejected stock-in unlocked before confirmation')
  await click('#stock-in-test .inventory-feedback[role=status] button')
  assert(!await evaluate("document.querySelector('#stock-in-test input[name=quantity_received]').disabled"), 'Confirmed rejected stock-in did not unlock for editing')
  await setInput('#stock-in-test input[name=quantity_received]', '4')
  await click('#stock-in-test .inventory-stock-form > .primary-action')
  await click('.inventory-confirmation-modal .primary-action')
  await waitForCondition("document.querySelector('[role=dialog] h2')?.textContent.includes('Stock In Recorded Successfully')")
  const rejectedStockKeys = await evaluate('stockInIdempotencyKeys.slice(-2)')
  assert(rejectedStockKeys.length === 2 && rejectedStockKeys[0] !== rejectedStockKeys[1], `Edited rejected stock-in did not receive a new idempotency key: ${JSON.stringify(rejectedStockKeys)}`)
  await click('.transaction-done-button')

  await evaluate('setInventoryProducts(inventoryFixtures)')
  await browserConnection.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate("document.querySelector('.inventory-product-list').scrollIntoView({ block: 'start' })")
  await delay(150)
  assert(await evaluate("document.querySelector('.inventory-product-list').scrollWidth <= document.querySelector('.inventory-product-list').clientWidth"), 'Inventory product section overflowed the mobile viewport')
  assert(await evaluate("document.querySelector('.inventory-product-list .table-scroll').scrollWidth > document.querySelector('.inventory-product-list .table-scroll').clientWidth"), 'Inventory table did not retain its responsive horizontal scroll container')
  inventoryScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(inventoryScreenshotRoot, 'mobile-product-table.png'), inventoryScreenshot.data, 'base64')
  await evaluate("document.querySelector('#inflow-records-test').scrollIntoView({ block: 'start' })")
  await delay(100)
  assert(await evaluate("document.querySelector('#inflow-records-test').scrollWidth <= document.querySelector('#inflow-records-test').clientWidth"), 'Inflow Records overflowed the mobile viewport')
  assert(await evaluate("document.querySelector('#inflow-records-test .table-scroll').scrollWidth > document.querySelector('#inflow-records-test .table-scroll').clientWidth"), 'FIFO batch table did not retain its responsive horizontal scroll container')
  inventoryScreenshot = await browserConnection.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  await writeFile(join(inventoryScreenshotRoot, 'mobile-fifo-batch-table.png'), inventoryScreenshot.data, 'base64')
  await browserConnection.command('Emulation.clearDeviceMetricsOverride')

  console.log('PASS 17-product pagination, Next/Previous, page counts, and clamping')
  console.log('PASS full-dataset sorting, search, category aliases, and combined filtering')
  console.log('PASS reactive inventory statistics for create, edit, and Stock In refreshes')
  console.log('PASS dashboard chart periods, tooltips, edge states, rankings, formatting, and mobile layout')
  console.log('PASS Activity Logs and Recent Activity Philippine timestamp consistency')
  console.log('PASS Activity Logs plain-language actions, identity display, filters, separators, and mobile layout')
  console.log('PASS User Accounts search, role filter, sorting, pagination, statuses, confirmations, failure preservation, and mobile layout')
  console.log(`ADMIN_SCREENSHOTS ${adminScreenshotRoot}`)
  console.log('PASS Add/Edit Product continuous typing, focus, keyboard, close, and submission behavior')
  console.log('PASS Product success confirmation and Stock In validation, review, failure, success, refresh, and duplicate prevention')
  console.log('PASS FIFO batch balances, consumption states, Sale 34 allocations, detail modal, and mobile containment')
  console.log('PASS Business Analytics KPI accuracy, chart tooltips, ranking order, keyboard access, and responsive layout')
  console.log(`ANALYTICS_SCREENSHOTS ${analyticsScreenshotRoot}`)
  console.log(`INVENTORY_SCREENSHOTS ${inventoryScreenshotRoot}`)
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
