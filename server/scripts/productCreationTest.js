import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import jwt from 'jsonwebtoken'
import mysql from 'mysql2/promise'

const testDatabase = 'lcp_product_creation_test'
const testPort = 5052
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
      // The isolated API is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error('Timed out waiting for the test API')
}

async function apiRequest(path, { token, method = 'GET', body } = {}) {
  const headers = {}

  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
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

  const [adminResult] = await admin.execute(
    "INSERT INTO users (fullname, username, password, role) VALUES ('Product Admin', 'product_admin', 'test-only', 'Admin')",
  )
  const [staffResult] = await admin.execute(
    "INSERT INTO users (fullname, username, password, role) VALUES ('Product Staff', 'product_staff', 'test-only', 'Staff')",
  )
  const [supplierResult] = await admin.execute(
    "INSERT INTO suppliers (supplier_name) VALUES ('Product Test Supplier')",
  )
  const [existingResult] = await admin.execute(
    `INSERT INTO products (
       product_name, category, unit, selling_price, stock_quantity, reorder_level, status
     ) VALUES ('Existing Product', 'Whole Chicken', 'piece', 125, 3, 1, 'Available')`,
  )

  api = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DB_NAME: testDatabase, PORT: String(testPort), NODE_ENV: 'test' },
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForServer(api)

  const adminToken = jwt.sign(
    { user_id: adminResult.insertId, role: 'Admin', auth_version: 0 },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  )
  const staffToken = jwt.sign(
    { user_id: staffResult.insertId, role: 'Staff', auth_version: 0 },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  )

  const unauthorized = await apiRequest('/products', {
    method: 'POST',
    body: {
      product_name: 'Unauthorized Product',
      category: 'Whole Chicken',
      unit: 'piece',
      selling_price: 100,
      reorder_level: 2,
    },
  })
  assert(unauthorized.status === 401, 'Unauthenticated product creation was not rejected')

  const categories = [
    ['Whole Chicken', 'Whole Chicken'],
    ['Prime Cuts', 'Prime Cuts'],
    ['Wings & Drumsticks', 'Wings and Drumsticks'],
    ['Innards & Offal', 'Innards and Offal'],
  ]

  for (const [submittedCategory, storedCategory] of categories) {
    const response = await apiRequest('/products', {
      token: adminToken,
      method: 'POST',
      body: {
        product_name: `Created ${submittedCategory}`,
        category: submittedCategory,
        unit: 'kg',
        selling_price: 175.5,
        reorder_level: 2.25,
        stock_quantity: 999,
        initial_stock: 999,
        status: 'Available',
      },
    })
    assert(response.status === 201, `${submittedCategory} could not be created`)
    const result = await response.json()
    assert(result.data.category === storedCategory, `${submittedCategory} was not mapped safely`)
    assert(Number(result.data.stock_quantity) === 0, `${submittedCategory} did not start at zero stock`)
    assert(result.data.status === 'Out of Stock', `${submittedCategory} did not start out of stock`)
  }

  const staffResponse = await apiRequest('/products', {
    token: staffToken,
    method: 'POST',
    body: {
      product_name: 'Staff Created Product',
      category: 'Wings and Drumsticks',
      unit: 'tray',
      selling_price: 200,
      reorder_level: 1,
    },
  })
  assert(staffResponse.status === 201, 'Existing Staff inventory access was not preserved')

  const invalidBodies = [
    { category: 'Whole Chicken', unit: 'kg', selling_price: 1, reorder_level: 1 },
    { product_name: 'Bad Category', category: 'Other', unit: 'kg', selling_price: 1, reorder_level: 1 },
    { product_name: 'Bad Unit', category: 'Whole Chicken', unit: ' ', selling_price: 1, reorder_level: 1 },
    { product_name: 'Bad Price', category: 'Whole Chicken', unit: 'kg', selling_price: -1, reorder_level: 1 },
    { product_name: 'Bad Price Type', category: 'Whole Chicken', unit: 'kg', selling_price: false, reorder_level: 1 },
    { product_name: 'Bad Reorder', category: 'Whole Chicken', unit: 'kg', selling_price: 1, reorder_level: -1 },
    { product_name: 'Bad Precision', category: 'Whole Chicken', unit: 'kg', selling_price: 1, reorder_level: 1.2345 },
  ]

  for (const invalidBody of invalidBodies) {
    const response = await apiRequest('/products', {
      token: adminToken,
      method: 'POST',
      body: invalidBody,
    })
    assert(response.status === 400, 'Invalid product input was not rejected')
  }

  const [[productCountAfterInvalidRequests]] = await admin.execute('SELECT COUNT(*) AS total FROM products')
  assert(Number(productCountAfterInvalidRequests.total) === 6, 'An invalid product request was persisted')

  const [createdProducts] = await admin.execute(
    `SELECT product_id, category, stock_quantity, status
     FROM products
     WHERE product_name LIKE 'Created %'
     ORDER BY product_id`,
  )
  assert(createdProducts.length === 4, 'Not all supported categories were persisted')
  assert(
    createdProducts.every((product) => Number(product.stock_quantity) === 0 && product.status === 'Out of Stock'),
    'A created product has an invalid initial inventory state',
  )

  const [[batchCountBeforeStockIn]] = await admin.execute('SELECT COUNT(*) AS total FROM stock_in')
  assert(Number(batchCountBeforeStockIn.total) === 0, 'Product creation fabricated a stock-in batch')

  const listResponse = await apiRequest('/products', { token: adminToken })
  assert(listResponse.status === 200, 'Product list could not be retrieved')
  const listResult = await listResponse.json()
  assert(
    listResult.data.some((product) => product.product_id === existingResult.insertId),
    'Existing product disappeared from the inventory list',
  )
  assert(
    createdProducts.every((created) => listResult.data.some((product) => product.product_id === created.product_id)),
    'A created product did not appear in the inventory list',
  )

  const stockInResponse = await apiRequest('/stock-in', {
    token: adminToken,
    method: 'POST',
    body: {
      supplier_id: supplierResult.insertId,
      product_id: createdProducts[0].product_id,
      quantity_received: 5.5,
      cost_price: 90,
      delivery_date: '2026-10-21T09:00:00',
    },
  })
  assert(stockInResponse.status === 201, 'Existing Stock In flow failed for a newly created product')

  const [[stockedProduct]] = await admin.execute(
    'SELECT stock_quantity, status FROM products WHERE product_id = ?',
    [createdProducts[0].product_id],
  )
  const [[batchCountAfterStockIn]] = await admin.execute(
    'SELECT COUNT(*) AS total FROM stock_in WHERE product_id = ?',
    [createdProducts[0].product_id],
  )
  assert(Number(stockedProduct.stock_quantity) === 5.5, 'Stock In did not update the created product')
  assert(Number(batchCountAfterStockIn.total) === 1, 'Stock In did not create exactly one FIFO batch')

  const editedProductId = createdProducts[0].product_id
  const saleResponse = await apiRequest('/sales', {
    token: adminToken,
    method: 'POST',
    body: {
      payment_type: 'Cash',
      amount_paid: 175.5,
      items: [{ product_id: editedProductId, quantity: 1 }],
    },
  })
  assert(saleResponse.status === 201, 'Sale setup for product relationship testing failed')

  const [batchesBeforeUpdate] = await admin.execute(
    `SELECT stockin_id, quantity_received, remaining_quantity, cost_price
     FROM stock_in
     WHERE product_id = ?
     ORDER BY stockin_id`,
    [editedProductId],
  )
  const [salesReferencesBeforeUpdate] = await admin.execute(
    'SELECT salesitem_id, sale_id, product_id, quantity, price, subtotal FROM sales_items WHERE product_id = ?',
    [editedProductId],
  )
  assert(salesReferencesBeforeUpdate.length === 1, 'Historical sale reference setup failed')

  const unauthorizedUpdate = await apiRequest(`/products/${editedProductId}`, {
    method: 'PATCH',
    body: { product_name: 'Unauthorized Edit' },
  })
  assert(unauthorizedUpdate.status === 401, 'Unauthenticated product update was not rejected')

  const protectedUpdates = [
    { product_id: 999 },
    { unit: 'piece' },
    { stock_quantity: 999 },
    { status: 'Available' },
    { is_active: false },
  ]

  for (const protectedUpdate of protectedUpdates) {
    const response = await apiRequest(`/products/${editedProductId}`, {
      token: adminToken,
      method: 'PATCH',
      body: protectedUpdate,
    })
    assert(response.status === 400, 'A protected product field update was not rejected')
  }

  const invalidUpdates = [
    { product_name: ' ' },
    { category: 'Unsupported' },
    { selling_price: -1 },
    { selling_price: 1.234 },
    { reorder_level: -1 },
    { reorder_level: 1.2345 },
  ]

  for (const invalidUpdate of invalidUpdates) {
    const response = await apiRequest(`/products/${editedProductId}`, {
      token: adminToken,
      method: 'PATCH',
      body: invalidUpdate,
    })
    assert(response.status === 400, 'An invalid product update was not rejected')
  }

  const malformedIdUpdate = await apiRequest('/products/not-a-number', {
    token: adminToken,
    method: 'PATCH',
    body: { product_name: 'Invalid ID' },
  })
  assert(malformedIdUpdate.status === 400, 'A malformed product ID was not rejected')

  const missingProductUpdate = await apiRequest('/products/2147483647', {
    token: adminToken,
    method: 'PATCH',
    body: { product_name: 'Missing Product' },
  })
  assert(missingProductUpdate.status === 404, 'A nonexistent product update did not return not found')

  const validUpdates = [
    [{ product_name: 'Edited Product Name' }, 'Product name'],
    [{ category: 'Innards & Offal' }, 'Category'],
    [{ selling_price: 222.25 }, 'Selling price'],
    [{ reorder_level: 10 }, 'Reorder level'],
  ]

  for (const [update, fieldName] of validUpdates) {
    const response = await apiRequest(`/products/${editedProductId}`, {
      token: adminToken,
      method: 'PATCH',
      body: update,
    })
    assert(response.status === 200, `${fieldName} could not be updated`)
    const result = await response.json()
    assert(result.data.product_id === editedProductId, `${fieldName} update changed the product ID`)
  }

  const staffUpdate = await apiRequest(`/products/${editedProductId}`, {
    token: staffToken,
    method: 'PATCH',
    body: { product_name: 'Staff Edited Product' },
  })
  assert(staffUpdate.status === 200, 'Existing Staff product-edit access was not preserved')

  const [[updatedProduct]] = await admin.execute(
    `SELECT product_id, product_name, category, unit, selling_price, stock_quantity, reorder_level, status
     FROM products
     WHERE product_id = ?`,
    [editedProductId],
  )
  const [batchesAfterUpdate] = await admin.execute(
    `SELECT stockin_id, quantity_received, remaining_quantity, cost_price
     FROM stock_in
     WHERE product_id = ?
     ORDER BY stockin_id`,
    [editedProductId],
  )
  const [salesReferencesAfterUpdate] = await admin.execute(
    'SELECT salesitem_id, sale_id, product_id, quantity, price, subtotal FROM sales_items WHERE product_id = ?',
    [editedProductId],
  )

  assert(updatedProduct.product_id === editedProductId, 'Product update changed the product ID')
  assert(updatedProduct.product_name === 'Staff Edited Product', 'Product name update was not persisted')
  assert(updatedProduct.category === 'Innards and Offal', 'Category update was not normalized')
  assert(Number(updatedProduct.selling_price) === 222.25, 'Selling price update was not persisted')
  assert(Number(updatedProduct.reorder_level) === 10, 'Reorder level update was not persisted')
  assert(updatedProduct.unit === 'kg', 'Product update changed the protected unit')
  assert(Number(updatedProduct.stock_quantity) === 4.5, 'Product update changed stock quantity')
  assert(updatedProduct.status === 'Low Stock', 'Reorder-level update did not reuse the stock status rule')
  assert(JSON.stringify(batchesAfterUpdate) === JSON.stringify(batchesBeforeUpdate), 'Product update changed FIFO batches')
  assert(
    JSON.stringify(salesReferencesAfterUpdate) === JSON.stringify(salesReferencesBeforeUpdate),
    'Product update changed historical sales references',
  )

  const updatedListResponse = await apiRequest('/products', { token: adminToken })
  const updatedListResult = await updatedListResponse.json()
  assert(
    updatedListResult.data.some(
      (product) => product.product_id === editedProductId && product.product_name === 'Staff Edited Product',
    ),
    'Updated product information did not appear in the inventory list',
  )

  console.log('PASS authenticated product creation and role access')
  console.log('PASS category compatibility and database persistence')
  console.log('PASS validation and zero-stock creation safeguards')
  console.log('PASS inventory listing and existing Stock In compatibility')
  console.log('PASS authenticated product editing and protected-field rejection')
  console.log('PASS product identity, stock, FIFO, and sales relationship preservation')
} finally {
  if (api && api.exitCode === null) api.kill()
  await admin.changeUser({ database: undefined }).catch(() => {})
  await admin.query(`DROP DATABASE IF EXISTS \`${testDatabase}\``).catch(() => {})
  await admin.end()
}
