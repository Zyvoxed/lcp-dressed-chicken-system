import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import jwt from 'jsonwebtoken'
import test from 'node:test'
import app from '../app.js'
import pool from '../config/database.js'

test('Staff can use POS lookups and checkout while direct administrative API calls are denied', async () => {
  const originalExecute = pool.execute
  const originalQuery = pool.query
  const originalGetConnection = pool.getConnection
  pool.execute = async (sql) => {
    if (sql.includes('SELECT role, is_active, auth_version')) {
      return [[{ role: 'Staff', is_active: 1, auth_version: 0 }]]
    }
    if (sql.includes('SELECT customer_id, customer_name, current_balance')) {
      return [[{ customer_id: 17, customer_name: 'POS Customer', current_balance: '90.00' }]]
    }
    if (sql.includes('FROM sales sa') && sql.includes("sa.payment_type = 'Credit'")) return [[], []]
    if (sql.includes('FROM payments pa') && sql.includes('WHERE pa.customer_id = ?')) return [[], []]
    if (sql.includes('FROM suppliers')) return [[{ supplier_id: 5, supplier_name: 'Active Supplier', contact_number: '555-0100' }]]
    if (sql.includes('FROM stock_in si')) return [[{ stockin_id: 12, supplier_name: 'Active Supplier', product_name: 'POS Product', unit: 'kg', quantity_received: '3.000', remaining_quantity: '2.000' }]]
    if (sql.includes('AS today_transactions')) return [[{ today_transactions: 3, outstanding_credits: '90.00' }]]
    if (sql.includes('SELECT transaction_type, reference_id')) return [[{ transaction_type: 'Sale', reference_id: 51, customer_name: 'POS Customer', status: 'Paid', occurred_at: '2026-11-22T10:00:00+08:00' }]]
    if (sql.includes('SELECT product_id, product_name, unit, stock_quantity, reorder_level, status')) return [[{ product_id: 4, product_name: 'POS Product', unit: 'kg', stock_quantity: '5.000', reorder_level: '1.000', status: 'Available' }]]
    if (sql.includes('SELECT p.unit, SUM(si.quantity)')) return [[{ unit: 'kg', total_quantity: '2.000' }]]
    if (sql.includes('SELECT si.stockin_id, s.supplier_name')) return [[{ stockin_id: 12, supplier_name: 'Active Supplier', product_name: 'POS Product', unit: 'kg', quantity_received: '3.000', delivery_date: '2026-11-22T09:00:00+08:00' }]]
    if (sql.includes('COUNT(*) AS total_records FROM products')) return [[{ total_records: 1 }]]
    if (sql.includes('COUNT(*) AS active_products')) return [[{ active_products: 1, low_stock_products: 0, out_of_stock_products: 0 }]]
    if (sql.includes('SELECT unit, SUM(stock_quantity)')) return [[{ unit: 'kg', total_quantity: '5.000' }]]
    if (sql.includes('SELECT product_id, product_name, category, unit, stock_quantity')) return [[{ product_id: 4, product_name: 'POS Product', category: 'Whole Chicken', unit: 'kg', stock_quantity: '5.000', reorder_level: '1.000', status: 'Available' }]]
    if (sql.includes('INSERT INTO customers')) return [{ insertId: 18 }, []]
    if (sql.includes('FROM idempotency_records')) return [[], []]
    throw new Error(`Unexpected Staff API query: ${sql}`)
  }
  pool.query = async (sql) => {
    if (sql.includes('FROM products')) {
      if (sql.includes('reorder_level')) {
        return [[{
          product_id: 4,
          product_name: 'POS Product',
          category: 'Whole Chicken',
          unit: 'kg',
          stock_quantity: '5.000',
          reorder_level: '1.000',
          status: 'Available',
        }]]
      }
      return [[{
        product_id: 4,
        product_name: 'POS Product',
        category: 'Whole Chicken',
        unit: 'kg',
        selling_price: '250.00',
        stock_quantity: '5.000',
      }]]
    }
    throw new Error(`Unexpected Staff API query: ${sql}`)
  }

  const server = createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  const token = jwt.sign({ user_id: 41, role: 'Staff', auth_version: 0, mfa_verified: true }, process.env.JWT_SECRET)
  const headers = { Authorization: `Bearer ${token}` }
  const base = `http://127.0.0.1:${port}/api`

  try {
    const productsResponse = await fetch(`${base}/products`, { headers })
    const products = await productsResponse.json()
    assert.equal(productsResponse.status, 200)
    assert.equal(products.data[0].product_id, 4)
    assert.equal(Object.hasOwn(products.data[0], 'reorder_level'), false)
    assert.equal(Object.hasOwn(products.data[0], 'status'), false)

    const customersResponse = await fetch(`${base}/customers`, { headers })
    const customers = await customersResponse.json()
    assert.equal(customersResponse.status, 200)
    assert.deepEqual(customers.data, [{ customer_id: 17, customer_name: 'POS Customer', current_balance: '90.00' }])

    for (const path of ['/customers/17', '/customers/17/credits', '/customers/17/payments']) {
      const response = await fetch(`${base}${path}`, { headers })
      assert.equal(response.status, 200, `${path} should be available to Staff for bookkeeping`)
    }

    const inventoryResponse = await fetch(`${base}/products/inventory`, { headers })
    const inventory = await inventoryResponse.json()
    assert.equal(inventoryResponse.status, 200)
    assert.equal(inventory.data[0].stock_quantity, '5.000')
    assert.equal(Object.hasOwn(inventory.data[0], 'selling_price'), false)

    const suppliersResponse = await fetch(`${base}/suppliers`, { headers })
    assert.equal(suppliersResponse.status, 200)
    assert.equal((await suppliersResponse.json()).data[0].supplier_name, 'Active Supplier')

    const stockInResponse = await fetch(`${base}/stock-in`, { headers })
    const stockIn = await stockInResponse.json()
    assert.equal(stockInResponse.status, 200)
    assert.equal(Object.hasOwn(stockIn.data[0], 'cost_price'), false)
    assert.equal(Object.hasOwn(stockIn.data[0], 'total_cost'), false)

    const dashboardResponse = await fetch(`${base}/analytics/dashboard`, { headers })
    const dashboard = await dashboardResponse.json()
    assert.equal(dashboardResponse.status, 200)
    assert.equal(Object.hasOwn(dashboard.data.summary, 'total_revenue'), false)
    assert.equal(Object.hasOwn(dashboard.data.recent_transactions[0], 'amount'), false)

    const operationalReportResponse = await fetch(`${base}/reports/operational/inventory`, { headers })
    const operationalReport = await operationalReportResponse.json()
    assert.equal(operationalReportResponse.status, 200)
    assert.equal(Object.hasOwn(operationalReport.data.records[0], 'selling_price'), false)

    const createCustomerResponse = await fetch(`${base}/customers`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: 'New POS Customer' }),
    })
    assert.equal(createCustomerResponse.status, 201)

    const checkoutResponse = await fetch(`${base}/sales`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(checkoutResponse.status, 400)
    assert.match((await checkoutResponse.json()).message, /Idempotency-Key/)

    const transactionStatements = []
    const connection = {
      async beginTransaction() { transactionStatements.push('BEGIN') },
      async execute(sql) {
        transactionStatements.push(sql)
        if (sql.includes('SELECT product_id, selling_price')) {
          return [[{ product_id: 4, selling_price: '250.00', stock_quantity: '5.000', reorder_level: '1.000' }]]
        }
        if (sql.includes('SELECT stockin_id, remaining_quantity')) {
          return [[{ stockin_id: 9, remaining_quantity: '5.000', cost_price: '100.00' }]]
        }
        if (sql.startsWith('INSERT INTO sales (')) return [{ insertId: 51 }]
        if (sql.startsWith('INSERT INTO sales_items')) return [{ insertId: 61 }]
        if (sql.startsWith('UPDATE idempotency_records')) return [{ affectedRows: 1 }]
        if (sql.startsWith('INSERT INTO idempotency_records')) return [{ affectedRows: 1 }]
        return [{ affectedRows: 1 }]
      },
      async commit() { transactionStatements.push('COMMIT') },
      async rollback() { transactionStatements.push('ROLLBACK') },
      release() { transactionStatements.push('RELEASE') },
    }
    pool.getConnection = async () => connection
    const successfulCheckout = await fetch(`${base}/sales`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-pos-checkout-1' },
      body: JSON.stringify({ payment_type: 'Cash', amount_paid: '250.00', items: [{ product_id: 4, quantity: '1.000' }] }),
    })
    assert.equal(successfulCheckout.status, 201)
    assert.equal((await successfulCheckout.json()).data.sale_id, 51)
    assert.equal(transactionStatements.at(-2), 'COMMIT')
    assert.equal(transactionStatements.includes('ROLLBACK'), false)

    const staffMutationStatements = []
    const staffConnection = {
      async beginTransaction() { staffMutationStatements.push('BEGIN') },
      async execute(sql, parameters = []) {
        staffMutationStatements.push({ sql: sql.replace(/\s+/g, ' ').trim(), parameters })
        if (sql.includes('SELECT supplier_id FROM suppliers')) return [[{ supplier_id: 5 }]]
        if (sql.includes('SELECT product_id, stock_quantity, reorder_level')) return [[{ product_id: 4, stock_quantity: '5.000', reorder_level: '1.000' }]]
        if (sql.includes('SELECT customer_id, payment_type')) return [[{ customer_id: 17, payment_type: 'Credit', total_amount: '100.00', amount_paid: '0.00', remaining_balance: '100.00', status: 'Unpaid' }]]
        if (sql.includes('SELECT current_balance')) return [[{ current_balance: '100.00' }]]
        if (sql.startsWith('INSERT INTO stock_in')) return [{ insertId: 72 }]
        if (sql.startsWith('INSERT INTO payments')) return [{ insertId: 73 }]
        if (sql.startsWith('INSERT INTO idempotency_records') || sql.startsWith('UPDATE idempotency_records')) return [{ affectedRows: 1 }]
        return [{ affectedRows: 1 }]
      },
      async commit() { staffMutationStatements.push('COMMIT') },
      async rollback() { staffMutationStatements.push('ROLLBACK') },
      release() { staffMutationStatements.push('RELEASE') },
    }
    pool.getConnection = async () => staffConnection
    const stockInCreate = await fetch(`${base}/stock-in`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-stock-in-1' },
      body: JSON.stringify({ supplier_id: 5, product_id: 4, quantity_received: '2.000', cost_price: '100.00', delivery_date: '2025-01-01T12:00:00.000Z' }),
    })
    assert.equal(stockInCreate.status, 201)
    const stockInInsert = staffMutationStatements.find((item) => typeof item === 'object' && item.sql.startsWith('INSERT INTO stock_in'))
    assert.equal(stockInInsert.parameters[2], 41, 'stock receipt records the authenticated Staff actor')
    assert.equal(staffMutationStatements.filter((item) => typeof item === 'object' && item.sql.startsWith('UPDATE products SET stock_quantity = stock_quantity +')).length, 1)

    const staffPayment = await fetch(`${base}/payments`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': 'staff-payment-1' },
      body: JSON.stringify({ sale_id: 52, payment_amount: '20.00' }),
    })
    const paymentResult = await staffPayment.json()
    assert.equal(staffPayment.status, 201)
    assert.equal(paymentResult.data.status, 'Partially Paid')
    const paymentInsert = staffMutationStatements.find((item) => typeof item === 'object' && item.sql.startsWith('INSERT INTO payments'))
    assert.equal(paymentInsert.parameters[2], 41, 'payment history records the authenticated Staff actor')
    assert.equal(staffMutationStatements.filter((item) => item === 'COMMIT').length, 2)

    const forbidden = [
      ['GET', '/sales'], ['GET', '/stock-in/1/allocations'],
      ['POST', '/suppliers'], ['PATCH', '/suppliers/1/archive'],
      ['GET', '/products/archived'], ['POST', '/products'], ['PATCH', '/products/1'],
      ['GET', '/analytics/dashboard/business'],
      ['GET', '/reports/sales'], ['GET', '/reports/receivables'],
      ['GET', '/reports/inventory'], ['GET', '/reports/sales/1'], ['GET', '/reports/product-sales?product_ids=4'], ['POST', '/reports/log'],
      ['GET', '/customers/17/sales'], ['GET', '/customers/archived'], ['PATCH', '/customers/17'],
      ['GET', '/activity-logs'], ['GET', '/users'], ['POST', '/users'],
    ]
    for (const [method, path] of forbidden) {
      const response = await fetch(`${base}${path}`, { method, headers })
      assert.equal(response.status, 403, `${method} ${path} must be denied to Staff`)
    }
    for (const path of ['/idempotency/payment/key', '/idempotency/stock_in/key']) {
      const response = await fetch(`${base}${path}`, { headers })
      assert.equal(response.status, 200, `${path} must allow Staff transaction recovery`)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
    pool.execute = originalExecute
    pool.query = originalQuery
    pool.getConnection = originalGetConnection
  }
})
