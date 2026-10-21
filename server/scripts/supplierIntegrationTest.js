import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'

const testDatabase = 'lcp_supplier_integration_test'
const testPort = 5052
const baseUrl = `http://127.0.0.1:${testPort}/api`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitForServer(child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Supplier test API exited before becoming ready')
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error('Timed out waiting for the supplier test API')
}

function request(path, token, options = {}) {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(`${baseUrl}${path}`, { ...options, headers })
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
  assert(/^[a-z0-9_]+$/.test(testDatabase), 'Unsafe supplier test database name')
  await admin.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``)
  const schema = (await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8')).replaceAll('lcp_business_system', testDatabase)
  await admin.query(schema)
  await admin.changeUser({ database: testDatabase })

  const passwordHash = await bcrypt.hash('supplier-test-only', 4)
  const [adminResult] = await admin.execute("INSERT INTO users (fullname, username, password, role) VALUES ('Supplier Admin', 'supplier_admin', ?, 'Admin')", [passwordHash])
  const [employeeResult] = await admin.execute("INSERT INTO users (fullname, username, password, role) VALUES ('Supplier Staff', 'supplier_staff', ?, 'Staff')", [passwordHash])
  await admin.execute("INSERT INTO suppliers (supplier_name, contact_person) VALUES ('Existing Supplier', 'Existing Contact')")

  api = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DB_NAME: testDatabase, PORT: String(testPort), NODE_ENV: 'test' },
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForServer(api)

  const adminToken = jwt.sign({ user_id: adminResult.insertId, role: 'Admin' }, process.env.JWT_SECRET, { expiresIn: '10m' })
  const employeeToken = jwt.sign({ user_id: employeeResult.insertId, role: 'Staff' }, process.env.JWT_SECRET, { expiresIn: '10m' })
  const jsonHeaders = { 'Content-Type': 'application/json' }

  const unauthenticatedRead = await request('/suppliers')
  assert(unauthenticatedRead.status === 401, 'Supplier directory allowed an unauthenticated read')
  const employeeRead = await request('/suppliers', employeeToken)
  assert(employeeRead.status === 200, 'Authenticated Stock In users could not retrieve suppliers')
  const restrictedCreate = await request('/suppliers', employeeToken, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ supplier_name: 'Restricted Supplier' }) })
  assert(restrictedCreate.status === 403, 'Non-Admin user created a supplier')
  const invalidCreate = await request('/suppliers', adminToken, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ supplier_name: '   ' }) })
  assert(invalidCreate.status === 400, 'Blank supplier name was accepted')

  const createResponse = await request('/suppliers', adminToken, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ supplier_name: '  New Supplier  ', contact_person: '  Maria Reyes  ', contact_number: ' 09170000000 ', address: ' Manila ' }),
  })
  const createBody = await createResponse.json()
  assert(createResponse.status === 201 && createBody.data?.supplier_id, 'Admin supplier creation failed')
  const [[persisted]] = await admin.execute('SELECT supplier_name, contact_person, contact_number, address FROM suppliers WHERE supplier_id = ?', [createBody.data.supplier_id])
  assert(persisted.supplier_name === 'New Supplier' && persisted.contact_person === 'Maria Reyes' && persisted.contact_number === '09170000000' && persisted.address === 'Manila', 'Supplier fields were not persisted using existing normalization')

  const [productResult] = await admin.execute("INSERT INTO products (product_name, category, unit, selling_price, stock_quantity, reorder_level, status) VALUES ('Supplier Test Product', 'Test', 'kg', 150, 4, 1, 'Available')")
  await admin.execute(
    `INSERT INTO stock_in (supplier_id, product_id, user_id, quantity_received, remaining_quantity, cost_price, total_cost, delivery_date)
     VALUES (?, ?, ?, 4, 4, 80, 320, '2026-10-21 16:28:00')`,
    [createBody.data.supplier_id, productResult.insertId, adminResult.insertId],
  )
  const directoryResponse = await request('/suppliers', adminToken)
  const directoryBody = await directoryResponse.json()
  assert(directoryBody.data.some((supplier) => supplier.supplier_id === createBody.data.supplier_id) && directoryBody.data.some((supplier) => supplier.supplier_name === 'Existing Supplier'), 'Supplier refresh omitted new or existing records')
  const stockResponse = await request('/stock-in', adminToken)
  const stockBody = await stockResponse.json()
  const delivery = stockBody.data.find((record) => record.supplier_id === createBody.data.supplier_id)
  assert(delivery?.supplier_name === 'New Supplier', 'Stock In history did not preserve the supplier relationship')
  assert(delivery.delivery_date === '2026-10-21T16:28:00+08:00', 'Stock In delivery timestamp did not declare the Manila wall-clock offset')

  console.log('PASS authenticated supplier reads and Admin-only creation')
  console.log('PASS supplier validation, persistence, refresh visibility, and existing-record preservation')
  console.log('PASS supplier relationship and Manila delivery timestamp in Stock In history')
} finally {
  if (api && api.exitCode === null) {
    api.kill()
    await Promise.race([new Promise((resolveExit) => api.once('exit', resolveExit)), new Promise((resolveDelay) => setTimeout(resolveDelay, 3000))])
  }
  await admin.changeUser({ database: undefined }).catch(() => {})
  await admin.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``).catch(() => {})
  await admin.end()
}
