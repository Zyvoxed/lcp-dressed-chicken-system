import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'
import {
  assertEmptyTestDatabase,
  assertRestrictedTestDatabaseGrants,
  getIsolatedTestDatabaseConfig,
  removeSchemaSelection,
} from './testDatabaseSafety.js'

const testPort = 5051
const baseUrl = `http://127.0.0.1:${testPort}/api`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Test API exited before becoming ready')
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Timed out waiting for the test API')
}

async function request(path, token, body, idempotencyKey = randomUUID()) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
}

async function read(path, token) {
  return fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

async function snapshot(connection, productId, customerId) {
  const [[product]] = await connection.query('SELECT stock_quantity FROM products WHERE product_id = ?', [productId])
  const [batches] = await connection.query(
    'SELECT quantity_received, remaining_quantity FROM stock_in WHERE product_id = ? ORDER BY delivery_date, stockin_id',
    [productId],
  )
  const [[customer]] = await connection.query('SELECT current_balance FROM customers WHERE customer_id = ?', [customerId])
  const [[counts]] = await connection.query(
    `SELECT (SELECT COUNT(*) FROM sales) sales,
            (SELECT COUNT(*) FROM sales_items) items,
            (SELECT COUNT(*) FROM payments) payments`,
  )
  return { stock: Number(product.stock_quantity), batches, balance: Number(customer.current_balance), counts }
}

const testDatabaseConfig = getIsolatedTestDatabaseConfig()
console.info(`Using isolated test MySQL host=${testDatabaseConfig.host}, database=${testDatabaseConfig.database}`)
const admin = await mysql.createConnection({
  host: testDatabaseConfig.host,
  port: testDatabaseConfig.port,
  user: testDatabaseConfig.user,
  password: testDatabaseConfig.password,
  database: testDatabaseConfig.database,
  multipleStatements: true,
})
let api

try {
  const [grants] = await admin.query('SHOW GRANTS')
  assertRestrictedTestDatabaseGrants(grants, testDatabaseConfig.database)
  await assertEmptyTestDatabase(admin, testDatabaseConfig.database)
  const schemaUrl = new URL('../../database/schema.sql', import.meta.url)
  const schema = removeSchemaSelection(await readFile(schemaUrl, 'utf8'))
  await admin.query(schema)

  const passwordHash = await bcrypt.hash('transaction-test-only', 4)
  const [userResult] = await admin.execute(
    `INSERT INTO users (fullname, username, password, role) VALUES
     ('Transaction Admin', 'transaction_admin', ?, 'Admin')`,
    [passwordHash],
  )
  const adminId = userResult.insertId
  const [employeeResult] = await admin.execute(
    `INSERT INTO users (fullname, username, password, role) VALUES
     ('Transaction Staff', 'transaction_staff', ?, 'Staff')`,
    [passwordHash],
  )
  const [supplierResult] = await admin.execute("INSERT INTO suppliers (supplier_name) VALUES ('Test Supplier')")
  const [customerResult] = await admin.execute("INSERT INTO customers (customer_name) VALUES ('Test Customer')")
  const [productResult] = await admin.execute(
    "INSERT INTO products (product_name, category, unit, selling_price, stock_quantity, reorder_level, status) VALUES ('FIFO Product', 'Test', 'kg', 100, 10, 2, 'Available')",
  )
  const supplierId = supplierResult.insertId
  const customerId = customerResult.insertId
  const productId = productResult.insertId
  await admin.execute(
    `INSERT INTO stock_in (supplier_id, product_id, user_id, quantity_received, remaining_quantity, cost_price, total_cost, delivery_date)
     VALUES (?, ?, ?, 4, 4, 60, 240, '2026-01-01'), (?, ?, ?, 6, 6, 70, 420, '2026-01-02')`,
    [supplierId, productId, adminId, supplierId, productId, adminId],
  )

  api = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      DB_HOST: testDatabaseConfig.host,
      DB_PORT: String(testDatabaseConfig.port),
      DB_USER: testDatabaseConfig.user,
      DB_PASSWORD: testDatabaseConfig.password,
      DB_NAME: testDatabaseConfig.database,
      DB_SSL: 'false',
      PORT: String(testPort),
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForServer(api)
  const token = jwt.sign({ user_id: adminId, role: 'Admin' }, process.env.JWT_SECRET, { expiresIn: '10m' })
  const employeeToken = jwt.sign({ user_id: employeeResult.insertId, role: 'Staff' }, process.env.JWT_SECRET, { expiresIn: '10m' })

  const original = await snapshot(admin, productId, customerId)
  await admin.query("CREATE TRIGGER fail_sale_allocation BEFORE INSERT ON sale_batch_allocations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled sale failure'")
  const failedSale = await request('/sales', token, { payment_type: 'Cash', amount_paid: 200, items: [{ product_id: productId, quantity: 2 }] })
  assert(failedSale.status === 500, 'Controlled sale did not fail')
  const afterSaleFailure = await snapshot(admin, productId, customerId)
  assert(JSON.stringify(afterSaleFailure) === JSON.stringify(original), 'Sale rollback left partial data')
  await admin.query('DROP TRIGGER fail_sale_allocation')
  console.log('PASS sale rollback')

  await admin.query("CREATE TRIGGER fail_stock_activity BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled stock-in failure'")
  const failedStockIn = await request('/stock-in', token, { supplier_id: supplierId, product_id: productId, quantity_received: 3, cost_price: 80, delivery_date: '2026-01-03' })
  assert(failedStockIn.status === 500, 'Controlled stock-in did not fail')
  const afterStockFailure = await snapshot(admin, productId, customerId)
  assert(JSON.stringify(afterStockFailure) === JSON.stringify(original), 'Stock-in rollback left partial data')
  await admin.query('DROP TRIGGER fail_stock_activity')
  console.log('PASS stock-in rollback')

  await admin.query("CREATE TRIGGER fail_credit_allocation BEFORE INSERT ON sale_batch_allocations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled credit failure'")
  const failedCredit = await request('/sales', token, { customer_id: customerId, payment_type: 'Credit', amount_paid: 0, items: [{ product_id: productId, quantity: 2 }] })
  assert(failedCredit.status === 500, 'Controlled credit sale did not fail')
  const afterCreditFailure = await snapshot(admin, productId, customerId)
  assert(JSON.stringify(afterCreditFailure) === JSON.stringify(original), 'Credit sale rollback left partial data')
  await admin.query('DROP TRIGGER fail_credit_allocation')
  console.log('PASS credit sale rollback')

  const credit = await request('/sales', token, { customer_id: customerId, payment_type: 'Credit', amount_paid: 0, items: [{ product_id: productId, quantity: 2 }] })
  assert(credit.status === 201, 'Credit sale setup failed')
  const creditBody = await credit.json()
  const afterCredit = await snapshot(admin, productId, customerId)
  assert(afterCredit.stock === 8 && Number(afterCredit.batches[0].remaining_quantity) === 2 && Number(afterCredit.batches[1].remaining_quantity) === 6, 'FIFO quantities are inconsistent')
  assert(Number(afterCredit.batches[0].quantity_received) === 4 && Number(afterCredit.batches[1].quantity_received) === 6, 'FIFO changed historical received quantities')
  assert(afterCredit.balance === 200, 'Credit balance is inconsistent')
  console.log('PASS FIFO and credit sale consistency')

  await admin.query("CREATE TRIGGER fail_payment_activity BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled payment failure'")
  const failedPaymentKey = randomUUID()
  const failedPaymentBody = { sale_id: creditBody.data.sale_id, payment_amount: 50 }
  const failedPayment = await request('/payments', token, failedPaymentBody, failedPaymentKey)
  assert(failedPayment.status === 500, 'Controlled payment did not fail')
  const failedPaymentStatusResponse = await read(`/idempotency/payment/${failedPaymentKey}`, token)
  const failedPaymentStatus = await failedPaymentStatusResponse.json()
  assert(failedPaymentStatusResponse.status === 200 && failedPaymentStatus.data.state === 'not_found', 'Failed payment was incorrectly reported as completed')
  const [[paymentSale]] = await admin.execute('SELECT amount_paid, remaining_balance FROM sales WHERE sale_id = ?', [creditBody.data.sale_id])
  const afterPaymentFailure = await snapshot(admin, productId, customerId)
  assert(Number(paymentSale.amount_paid) === 0 && Number(paymentSale.remaining_balance) === 200, 'Payment rollback changed the sale')
  assert(afterPaymentFailure.balance === 200 && Number(afterPaymentFailure.counts.payments) === 0, 'Payment rollback left partial data')
  await admin.query('DROP TRIGGER fail_payment_activity')
  console.log('PASS payment rollback')

  const successfulPayment = await request('/payments', token, failedPaymentBody, failedPaymentKey)
  assert(successfulPayment.status === 201, 'Successful payment setup failed')
  const successfulPaymentBody = await successfulPayment.json()
  const paymentReplays = await Promise.all([
    request('/payments', token, failedPaymentBody, failedPaymentKey),
    request('/payments', token, failedPaymentBody, failedPaymentKey),
  ])
  const paymentReplayBodies = await Promise.all(paymentReplays.map((response) => response.json()))
  assert(
    paymentReplays.every((response) => response.status === 201)
      && paymentReplayBodies.every((body) => body.data.payment_id === successfulPaymentBody.data.payment_id),
    'Concurrent payment retries were not replayed safely',
  )
  const changedPayment = await request(
    '/payments',
    token,
    { sale_id: creditBody.data.sale_id, payment_amount: 51 },
    failedPaymentKey,
  )
  assert(changedPayment.status === 409, 'Payment idempotency key accepted a different payload')
  const [[paymentState]] = await admin.execute(
    `SELECT sa.remaining_balance, c.current_balance,
            (SELECT COUNT(*) FROM payments p WHERE p.sale_id = sa.sale_id) AS payment_count
     FROM sales sa JOIN customers c ON c.customer_id = sa.customer_id
     WHERE sa.sale_id = ?`,
    [creditBody.data.sale_id],
  )
  assert(
    Number(paymentState.remaining_balance) === 150
      && Number(paymentState.current_balance) === 150
      && Number(paymentState.payment_count) === 1,
    'Payment retry changed balances or payment records more than once',
  )
  const completedPaymentStatusResponse = await read(`/idempotency/payment/${failedPaymentKey}`, token)
  const completedPaymentStatus = await completedPaymentStatusResponse.json()
  assert(
    completedPaymentStatusResponse.status === 200
      && completedPaymentStatus.data.state === 'completed'
      && completedPaymentStatus.data.response.data.payment_id === successfulPaymentBody.data.payment_id,
    'Completed payment recovery did not return the original result',
  )
  console.log('PASS payment retry, replay, mismatch, and balance idempotency')
  const detailResponse = await read(`/reports/sales/${creditBody.data.sale_id}`, token)
  const detailBody = await detailResponse.json()
  assert(detailResponse.status === 200, 'Admin could not retrieve sale report details')
  assert(detailBody.data.sale.sale_id === creditBody.data.sale_id, 'Sale detail returned the wrong transaction')
  assert(detailBody.data.items.length === 1 && Number(detailBody.data.items[0].price) === 100, 'Sale detail did not preserve stored item pricing')
  assert(detailBody.data.payments.length === 1 && Number(detailBody.data.payments[0].payment_amount) === 50, 'Sale detail did not return sale-specific payments')
  const creditHistoryResponse = await read(`/customers/${customerId}/credits`, token)
  const paymentHistoryResponse = await read(`/customers/${customerId}/payments`, token)
  const salesReportResponse = await read('/reports/sales', token)
  const creditHistory = await creditHistoryResponse.json()
  const paymentHistory = await paymentHistoryResponse.json()
  const salesReport = await salesReportResponse.json()
  const matchingCredit = creditHistory.data.find((sale) => sale.sale_id === creditBody.data.sale_id)
  const matchingPayment = paymentHistory.data.find((payment) => payment.sale_id === creditBody.data.sale_id)
  const matchingReportSale = salesReport.data.records.find((sale) => sale.sale_id === creditBody.data.sale_id)
  assert(matchingCredit.sale_date === detailBody.data.sale.sale_date && matchingReportSale.sale_date === matchingCredit.sale_date, 'Matching sale timestamps differed across Reports and Customer Credits')
  assert(matchingPayment.payment_date === detailBody.data.payments[0].payment_date, 'Matching payment timestamps differed across detail and payment history')
  assert(matchingCredit.sale_date.endsWith('+08:00') && matchingPayment.payment_date.endsWith('+08:00'), 'Transaction APIs did not declare the Manila offset')
  const restrictedDetail = await read(`/reports/sales/${creditBody.data.sale_id}`, employeeToken)
  assert(restrictedDetail.status === 403, 'Sale report details were not restricted to Admin')
  console.log('PASS read-only sale detail data and Admin authorization')

  const [concurrentProduct] = await admin.execute(
    "INSERT INTO products (product_name, category, unit, selling_price, stock_quantity, reorder_level, status) VALUES ('Concurrent Product', 'Test', 'kg', 100, 10, 2, 'Available')",
  )
  await admin.execute(
    `INSERT INTO stock_in (supplier_id, product_id, user_id, quantity_received, remaining_quantity, cost_price, total_cost, delivery_date)
     VALUES (?, ?, ?, 10, 10, 50, 500, '2026-01-01')`,
    [supplierId, concurrentProduct.insertId, adminId],
  )
  const concurrentBody = { payment_type: 'Cash', amount_paid: 600, items: [{ product_id: concurrentProduct.insertId, quantity: 6 }] }
  const concurrentKey = randomUUID()
  const concurrentResponses = await Promise.all([
    request('/sales', token, concurrentBody, concurrentKey),
    request('/sales', token, concurrentBody, concurrentKey),
  ])
  const concurrentBodies = await Promise.all(concurrentResponses.map((response) => response.json()))
  const statuses = concurrentResponses.map((response) => response.status).sort()
  const [[concurrentStock]] = await admin.execute('SELECT stock_quantity FROM products WHERE product_id = ?', [concurrentProduct.insertId])
  assert(
    statuses[0] === 201 && statuses[1] === 201
      && concurrentBodies[0].data.sale_id === concurrentBodies[1].data.sale_id
      && Number(concurrentStock.stock_quantity) === 4,
    'Concurrent duplicate sales were not replayed safely',
  )
  const conflictingReplay = await request(
    '/sales',
    token,
    { ...concurrentBody, items: [{ product_id: concurrentProduct.insertId, quantity: 5 }] },
    concurrentKey,
  )
  assert(conflictingReplay.status === 409, 'Reusing a key with a different payload was not rejected')
  console.log('PASS idempotent concurrent sale replay and payload mismatch')

  const [saleRetryProduct] = await admin.execute(
    "INSERT INTO products (product_name, category, unit, selling_price, stock_quantity, reorder_level, status) VALUES ('Sale Retry Product', 'Test', 'kg', 100, 10, 2, 'Available')",
  )
  await admin.execute(
    `INSERT INTO stock_in (supplier_id, product_id, user_id, quantity_received, remaining_quantity, cost_price, total_cost, delivery_date)
     VALUES (?, ?, ?, 10, 10, 50, 500, '2026-01-01')`,
    [supplierId, saleRetryProduct.insertId, adminId],
  )
  const saleRetryBody = {
    payment_type: 'Cash',
    amount_paid: 200,
    items: [{ product_id: saleRetryProduct.insertId, quantity: 2 }],
  }
  const saleRetryKey = randomUUID()
  await admin.query("CREATE TRIGGER fail_retry_sale BEFORE INSERT ON sale_batch_allocations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled first sale failure'")
  const failedRetrySale = await request('/sales', token, saleRetryBody, saleRetryKey)
  assert(failedRetrySale.status === 500, 'Controlled first sale attempt did not fail')
  const failedSaleStatusResponse = await read(`/idempotency/sale/${saleRetryKey}`, token)
  const failedSaleStatus = await failedSaleStatusResponse.json()
  assert(failedSaleStatusResponse.status === 200 && failedSaleStatus.data.state === 'not_found', 'Failed sale was incorrectly reported as completed')
  await admin.query('DROP TRIGGER fail_retry_sale')
  const recoveredSale = await request('/sales', token, saleRetryBody, saleRetryKey)
  assert(recoveredSale.status === 201, 'A failed sale could not be retried with its original key')
  const recoveredSaleBody = await recoveredSale.json()
  const completedSaleStatusResponse = await read(`/idempotency/sale/${saleRetryKey}`, token)
  const completedSaleStatus = await completedSaleStatusResponse.json()
  assert(
    completedSaleStatusResponse.status === 200
      && completedSaleStatus.data.state === 'completed'
      && completedSaleStatus.data.response.data.sale_id === recoveredSaleBody.data.sale_id,
    'Completed sale recovery did not return the original result',
  )
  const duplicateRecoveredSale = await request('/sales', token, saleRetryBody, saleRetryKey)
  const duplicateRecoveredBody = await duplicateRecoveredSale.json()
  const [[saleRetryStock]] = await admin.execute(
    `SELECT p.stock_quantity,
            (SELECT COUNT(DISTINCT si.sale_id) FROM sales_items si WHERE si.product_id = p.product_id) AS sale_count,
            (SELECT COUNT(*) FROM sales_items si WHERE si.product_id = p.product_id) AS item_count
     FROM products p WHERE p.product_id = ?`,
    [saleRetryProduct.insertId],
  )
  assert(
    duplicateRecoveredSale.status === 201
      && duplicateRecoveredBody.data.sale_id === recoveredSaleBody.data.sale_id
      && Number(saleRetryStock.stock_quantity) === 8
      && Number(saleRetryStock.sale_count) === 1
      && Number(saleRetryStock.item_count) === 1,
    'Retry after sale failure or a lost response duplicated the sale',
  )
  console.log('PASS failed sale retry and lost-response replay')

  const [stockRetryProduct] = await admin.execute(
    "INSERT INTO products (product_name, category, unit, selling_price, stock_quantity, reorder_level, status) VALUES ('Stock Retry Product', 'Test', 'kg', 100, 0, 2, 'Out of Stock')",
  )
  const stockRetryBody = {
    supplier_id: supplierId,
    product_id: stockRetryProduct.insertId,
    quantity_received: 3,
    cost_price: 80,
    delivery_date: '2026-01-03',
  }
  const stockRetryKey = randomUUID()
  await admin.query("CREATE TRIGGER fail_retry_stock_in BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'controlled first stock-in failure'")
  const failedRetryStock = await request('/stock-in', token, stockRetryBody, stockRetryKey)
  assert(failedRetryStock.status === 500, 'Controlled first stock-in attempt did not fail')
  const failedStockStatusResponse = await read(`/idempotency/stock_in/${stockRetryKey}`, token)
  const failedStockStatus = await failedStockStatusResponse.json()
  assert(failedStockStatusResponse.status === 200 && failedStockStatus.data.state === 'not_found', 'Failed stock-in was incorrectly reported as completed')
  await admin.query('DROP TRIGGER fail_retry_stock_in')
  const recoveredStock = await request('/stock-in', token, stockRetryBody, stockRetryKey)
  assert(recoveredStock.status === 201, 'A failed stock-in could not be retried with its original key')
  const recoveredStockBody = await recoveredStock.json()
  const completedStockStatusResponse = await read(`/idempotency/stock_in/${stockRetryKey}`, token)
  const completedStockStatus = await completedStockStatusResponse.json()
  assert(
    completedStockStatusResponse.status === 200
      && completedStockStatus.data.state === 'completed'
      && completedStockStatus.data.response.data.stockin_id === recoveredStockBody.data.stockin_id,
    'Completed stock-in recovery did not return the original result',
  )
  const duplicateStockRequests = await Promise.all([
    request('/stock-in', token, stockRetryBody, stockRetryKey),
    request('/stock-in', token, stockRetryBody, stockRetryKey),
  ])
  const duplicateStockBodies = await Promise.all(duplicateStockRequests.map((response) => response.json()))
  const changedStock = await request(
    '/stock-in',
    token,
    { ...stockRetryBody, quantity_received: 4 },
    stockRetryKey,
  )
  const [[stockRetryState]] = await admin.execute(
    `SELECT p.stock_quantity,
            (SELECT COUNT(*) FROM stock_in si WHERE si.product_id = p.product_id) AS batch_count
     FROM products p WHERE p.product_id = ?`,
    [stockRetryProduct.insertId],
  )
  assert(
    duplicateStockRequests.every((response) => response.status === 201)
      && duplicateStockBodies.every((body) => body.data.stockin_id === recoveredStockBody.data.stockin_id)
      && changedStock.status === 409
      && Number(stockRetryState.stock_quantity) === 3
      && Number(stockRetryState.batch_count) === 1,
    'Stock-in duplicate requests changed inventory more than once',
  )
  console.log('PASS stock-in retry, concurrent replay, payload mismatch, and stock consistency')

  const [competingProduct] = await admin.execute(
    "INSERT INTO products (product_name, category, unit, selling_price, stock_quantity, reorder_level, status) VALUES ('Competing Product', 'Test', 'kg', 100, 10, 2, 'Available')",
  )
  await admin.execute(
    `INSERT INTO stock_in (supplier_id, product_id, user_id, quantity_received, remaining_quantity, cost_price, total_cost, delivery_date)
     VALUES (?, ?, ?, 10, 10, 50, 500, '2026-01-01')`,
    [supplierId, competingProduct.insertId, adminId],
  )
  const competingBody = {
    payment_type: 'Cash',
    amount_paid: 600,
    items: [{ product_id: competingProduct.insertId, quantity: 6 }],
  }
  const competingResponses = await Promise.all([
    request('/sales', token, competingBody),
    request('/sales', token, competingBody),
  ])
  const competingStatuses = competingResponses.map((response) => response.status).sort()
  const [[competingStock]] = await admin.execute(
    'SELECT stock_quantity FROM products WHERE product_id = ?',
    [competingProduct.insertId],
  )
  assert(
    competingStatuses[0] === 201 && competingStatuses[1] === 409
      && Number(competingStock.stock_quantity) === 4,
    'Concurrent independent sales oversold inventory',
  )
  console.log('PASS concurrent independent sale stock protection')
} finally {
  if (api && api.exitCode === null) api.kill()
  await admin.end()
}
