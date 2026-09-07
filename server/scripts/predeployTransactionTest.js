import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'

const testDatabase = 'lcp_predeploy_transaction_test'
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

async function request(path, token, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

const admin = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
})
let api

try {
  assert(/^[a-z0-9_]+$/.test(testDatabase), 'Unsafe test database name')
  await admin.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``)
  const schemaUrl = new URL('../../database/schema.sql', import.meta.url)
  const schema = (await readFile(schemaUrl, 'utf8')).replaceAll('lcp_business_system', testDatabase)
  await admin.query(schema)
  await admin.changeUser({ database: testDatabase })

  const passwordHash = await bcrypt.hash('transaction-test-only', 4)
  const [userResult] = await admin.execute(
    `INSERT INTO users (fullname, username, password, role) VALUES
     ('Transaction Admin', 'transaction_admin', ?, 'Admin')`,
    [passwordHash],
  )
  const adminId = userResult.insertId
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
    env: { ...process.env, DB_NAME: testDatabase, PORT: String(testPort), NODE_ENV: 'test' },
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForServer(api)
  const token = jwt.sign({ user_id: adminId, role: 'Admin' }, process.env.JWT_SECRET, { expiresIn: '10m' })

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
  const failedPayment = await request('/payments', token, { sale_id: creditBody.data.sale_id, payment_amount: 50 })
  assert(failedPayment.status === 500, 'Controlled payment did not fail')
  const [[paymentSale]] = await admin.execute('SELECT amount_paid, remaining_balance FROM sales WHERE sale_id = ?', [creditBody.data.sale_id])
  const afterPaymentFailure = await snapshot(admin, productId, customerId)
  assert(Number(paymentSale.amount_paid) === 0 && Number(paymentSale.remaining_balance) === 200, 'Payment rollback changed the sale')
  assert(afterPaymentFailure.balance === 200 && Number(afterPaymentFailure.counts.payments) === 0, 'Payment rollback left partial data')
  await admin.query('DROP TRIGGER fail_payment_activity')
  console.log('PASS payment rollback')

  const [concurrentProduct] = await admin.execute(
    "INSERT INTO products (product_name, category, unit, selling_price, stock_quantity, reorder_level, status) VALUES ('Concurrent Product', 'Test', 'kg', 100, 10, 2, 'Available')",
  )
  await admin.execute(
    `INSERT INTO stock_in (supplier_id, product_id, user_id, quantity_received, remaining_quantity, cost_price, total_cost, delivery_date)
     VALUES (?, ?, ?, 10, 10, 50, 500, '2026-01-01')`,
    [supplierId, concurrentProduct.insertId, adminId],
  )
  const concurrentBody = { payment_type: 'Cash', amount_paid: 600, items: [{ product_id: concurrentProduct.insertId, quantity: 6 }] }
  const concurrentResponses = await Promise.all([request('/sales', token, concurrentBody), request('/sales', token, concurrentBody)])
  const statuses = concurrentResponses.map((response) => response.status).sort()
  const [[concurrentStock]] = await admin.execute('SELECT stock_quantity FROM products WHERE product_id = ?', [concurrentProduct.insertId])
  assert(statuses[0] === 201 && statuses[1] === 409 && Number(concurrentStock.stock_quantity) === 4, 'Concurrent sales oversold inventory')
  console.log('PASS concurrent stock protection')
} finally {
  if (api && api.exitCode === null) api.kill()
  await admin.changeUser({ database: undefined }).catch(() => {})
  await admin.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``).catch(() => {})
  await admin.end()
}
