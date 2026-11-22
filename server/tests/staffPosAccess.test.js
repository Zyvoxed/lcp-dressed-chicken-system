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
    if (sql.includes('SELECT customer_id, customer_name')) {
      return [[{ customer_id: 17, customer_name: 'POS Customer' }]]
    }
    if (sql.includes('INSERT INTO customers')) return [{ insertId: 18 }, []]
    if (sql.includes('FROM idempotency_records')) return [[], []]
    throw new Error(`Unexpected Staff API query: ${sql}`)
  }
  pool.query = async (sql) => {
    if (sql.includes('FROM products')) {
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
    assert.deepEqual(customers.data, [{ customer_id: 17, customer_name: 'POS Customer' }])

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

    const forbidden = [
      ['GET', '/sales'], ['GET', '/stock-in'], ['GET', '/stock-in/1/allocations'],
      ['POST', '/stock-in'], ['GET', '/suppliers'], ['POST', '/suppliers'], ['PATCH', '/suppliers/1/archive'],
      ['GET', '/products/archived'], ['POST', '/products'], ['PATCH', '/products/1'],
      ['GET', '/analytics/dashboard'], ['GET', '/analytics/dashboard/business'],
      ['GET', '/reports/sales'], ['GET', '/reports/receivables'],
      ['GET', '/reports/inventory'], ['GET', '/reports/sales/1'], ['GET', '/reports/product-sales?product_ids=4'], ['POST', '/reports/log'],
      ['GET', '/customers/17/credits'], ['GET', '/customers/17/payments'],
      ['GET', '/customers/17/sales'], ['GET', '/customers/17'], ['GET', '/customers/archived'], ['PATCH', '/customers/17'],
      ['POST', '/payments'], ['GET', '/idempotency/payment/key'],
      ['GET', '/idempotency/stock_in/key'], ['GET', '/activity-logs'], ['GET', '/users'], ['POST', '/users'],
    ]
    for (const [method, path] of forbidden) {
      const response = await fetch(`${base}${path}`, { method, headers })
      assert.equal(response.status, 403, `${method} ${path} must be denied to Staff`)
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
    pool.execute = originalExecute
    pool.query = originalQuery
    pool.getConnection = originalGetConnection
  }
})
