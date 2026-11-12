import pool from '../config/database.js'

class CustomerError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const editableCustomerFields = new Set(['customer_name', 'contact_number', 'address'])

const customerSelectFields = `
  c.customer_id,
  c.customer_name,
  c.contact_number,
  c.address,
  c.current_balance,
  c.is_active,
  c.created_at,
  COALESCE(credit_totals.total_credit, 0) AS total_credit,
  COALESCE(credit_totals.total_paid, 0) AS total_paid,
  payment_totals.last_payment_at
`

const customerFinancialJoins = `
  LEFT JOIN (
    SELECT customer_id,
           SUM(total_amount) AS total_credit,
           SUM(amount_paid) AS total_paid
    FROM sales
    WHERE payment_type = 'Credit'
    GROUP BY customer_id
  ) credit_totals ON credit_totals.customer_id = c.customer_id
  LEFT JOIN (
    SELECT customer_id,
           CONCAT(DATE_FORMAT(MAX(payment_date), '%Y-%m-%dT%H:%i:%s'), '+08:00') AS last_payment_at
    FROM payments
    GROUP BY customer_id
  ) payment_totals ON payment_totals.customer_id = c.customer_id
`

function parseCustomerId(value) {
  const customerId = Number(value)
  return Number.isInteger(customerId) && customerId > 0 ? customerId : null
}

function parseCustomerName(value) {
  if (typeof value !== 'string') throw new CustomerError(400, 'Customer name must be text')
  const customerName = value.trim()
  if (!customerName) throw new CustomerError(400, 'Customer name is required')
  if (customerName.length > 100) throw new CustomerError(400, 'Customer name must not exceed 100 characters')
  return customerName
}

function parseOptionalText(value, label, maximumLength) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new CustomerError(400, `${label} must be text`)
  const normalized = value.trim()
  if (maximumLength && normalized.length > maximumLength) {
    throw new CustomerError(400, `${label} must not exceed ${maximumLength} characters`)
  }
  return normalized || null
}

function failure(error, response, fallback) {
  if (error instanceof CustomerError) {
    return response.status(error.status).json({ success: false, message: error.message })
  }
  console.error(`${fallback}:`, error.message)
  return response.status(500).json({ success: false, message: fallback })
}

export async function getCustomers(request, response) {
  try {
    const [customers] = await pool.execute(`
      SELECT ${customerSelectFields}
      FROM customers c
      ${customerFinancialJoins}
      WHERE c.is_active = TRUE
      ORDER BY c.customer_name ASC
    `)
    return response.json({ success: true, data: customers })
  } catch (error) {
    console.error('Unable to retrieve customers:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customers' })
  }
}

export async function getArchivedCustomers(request, response) {
  try {
    const [customers] = await pool.execute(`
      SELECT ${customerSelectFields}
      FROM customers c
      ${customerFinancialJoins}
      WHERE c.is_active = FALSE
      ORDER BY c.customer_name ASC
    `)
    return response.json({ success: true, data: customers })
  } catch (error) {
    console.error('Unable to retrieve archived customers:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve archived customers' })
  }
}

export async function archiveCustomer(request, response) {
  let connection
  let transactionStarted = false

  try {
    const customerId = parseCustomerId(request.params.id)
    if (!customerId) throw new CustomerError(400, 'Invalid customer ID')

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const [customers] = await connection.execute(
      `SELECT customer_id, customer_name, current_balance, is_active
       FROM customers
       WHERE customer_id = ?
       LIMIT 1
       FOR UPDATE`,
      [customerId],
    )
    const customer = customers[0]
    if (!customer) throw new CustomerError(404, 'Customer not found')
    if (!customer.is_active) throw new CustomerError(409, 'Customer is already archived')
    if (Number(customer.current_balance) > 0) {
      throw new CustomerError(409, 'Customer has an outstanding balance. Settle the balance before archiving this customer.')
    }

    await connection.execute(
      'UPDATE customers SET is_active = FALSE WHERE customer_id = ?',
      [customerId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'CUSTOMER_ARCHIVED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Customer ${customerId} (${customer.customer_name}) archived`],
    )
    await connection.commit()
    transactionStarted = false

    return response.json({
      success: true,
      message: 'Customer archived successfully',
      data: { customer_id: customerId, customer_name: customer.customer_name, is_active: false },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    return failure(error, response, 'Unable to archive customer')
  } finally {
    connection?.release()
  }
}

export async function restoreCustomer(request, response) {
  let connection
  let transactionStarted = false

  try {
    const customerId = parseCustomerId(request.params.id)
    if (!customerId) throw new CustomerError(400, 'Invalid customer ID')

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const [customers] = await connection.execute(
      `SELECT customer_id, customer_name, is_active
       FROM customers
       WHERE customer_id = ?
       LIMIT 1
       FOR UPDATE`,
      [customerId],
    )
    const customer = customers[0]
    if (!customer) throw new CustomerError(404, 'Customer not found')
    if (customer.is_active) throw new CustomerError(409, 'Customer is already active')

    await connection.execute(
      'UPDATE customers SET is_active = TRUE WHERE customer_id = ?',
      [customerId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'CUSTOMER_RESTORED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Customer ${customerId} (${customer.customer_name}) restored`],
    )
    await connection.commit()
    transactionStarted = false

    return response.json({
      success: true,
      message: 'Customer restored successfully',
      data: { customer_id: customerId, customer_name: customer.customer_name, is_active: true },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    return failure(error, response, 'Unable to restore customer')
  } finally {
    connection?.release()
  }
}

export async function createCustomer(request, response) {
  try {
    const customerName = parseCustomerName(request.body?.customer_name)
    const contactNumber = parseOptionalText(request.body?.contact_number, 'Contact number', 20)
    const address = parseOptionalText(request.body?.address, 'Address')
    const [result] = await pool.execute(
      'INSERT INTO customers (customer_name, contact_number, address) VALUES (?, ?, ?)',
      [customerName, contactNumber, address],
    )
    return response.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: { customer_id: result.insertId },
    })
  } catch (error) {
    return failure(error, response, 'Unable to create customer')
  }
}

export async function updateCustomer(request, response) {
  let connection
  let transactionStarted = false

  try {
    const customerId = parseCustomerId(request.params.id)
    if (!customerId) throw new CustomerError(400, 'Invalid customer ID')
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new CustomerError(400, 'A customer update is required')
    }

    const submittedFields = Object.keys(body)
    if (!submittedFields.length) throw new CustomerError(400, 'At least one customer field is required')
    if (submittedFields.some((field) => !editableCustomerFields.has(field))) {
      throw new CustomerError(400, 'Only customer name, contact number, and address can be updated')
    }

    const updates = []
    const values = []
    if (Object.hasOwn(body, 'customer_name')) {
      updates.push('customer_name = ?')
      values.push(parseCustomerName(body.customer_name))
    }
    if (Object.hasOwn(body, 'contact_number')) {
      updates.push('contact_number = ?')
      values.push(parseOptionalText(body.contact_number, 'Contact number', 20))
    }
    if (Object.hasOwn(body, 'address')) {
      updates.push('address = ?')
      values.push(parseOptionalText(body.address, 'Address'))
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true
    const [customers] = await connection.execute(
      `SELECT customer_id
       FROM customers
       WHERE customer_id = ? AND is_active = TRUE
       LIMIT 1
       FOR UPDATE`,
      [customerId],
    )
    if (!customers[0]) throw new CustomerError(404, 'Customer not found')

    await connection.execute(
      `UPDATE customers SET ${updates.join(', ')} WHERE customer_id = ?`,
      [...values, customerId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'CUSTOMER_UPDATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Customer ${customerId} details updated`],
    )
    const [updatedCustomers] = await connection.execute(
      `SELECT customer_id, customer_name, contact_number, address, current_balance, created_at
       FROM customers
       WHERE customer_id = ? AND is_active = TRUE
       LIMIT 1`,
      [customerId],
    )
    await connection.commit()
    transactionStarted = false
    return response.json({
      success: true,
      message: 'Customer updated successfully',
      data: updatedCustomers[0],
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    return failure(error, response, 'Unable to update customer')
  } finally {
    connection?.release()
  }
}

export async function getCustomer(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [customers] = await pool.execute(
      `SELECT ${customerSelectFields}
       FROM customers c
       ${customerFinancialJoins}
       WHERE c.customer_id = ? LIMIT 1`,
      [customerId],
    )
    if (!customers[0]) return response.status(404).json({ success: false, message: 'Customer not found' })
    return response.json({ success: true, data: customers[0] })
  } catch (error) {
    console.error('Unable to retrieve customer:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer' })
  }
}

export async function getCustomerSales(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [sales] = await pool.execute(
      `SELECT sa.sale_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              sa.payment_type,
              sa.total_amount,
              sa.amount_paid,
              sa.remaining_balance,
              sa.status,
              COUNT(si.salesitem_id) AS item_count
       FROM sales sa
       LEFT JOIN sales_items si ON si.sale_id = sa.sale_id
       WHERE sa.customer_id = ?
       GROUP BY sa.sale_id, sa.sale_date, sa.payment_type, sa.total_amount,
                sa.amount_paid, sa.remaining_balance, sa.status
       ORDER BY sa.sale_date DESC, sa.sale_id DESC`,
      [customerId],
    )
    return response.json({ success: true, data: sales })
  } catch (error) {
    console.error('Unable to retrieve customer sales:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer sales' })
  }
}

export async function getCustomerCredits(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [credits] = await pool.execute(
      `SELECT sa.sale_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              sa.total_amount, sa.amount_paid,
              sa.remaining_balance, sa.status, u.fullname AS recorded_by
       FROM sales sa JOIN users u ON sa.user_id = u.user_id
       WHERE sa.customer_id = ? AND sa.payment_type = 'Credit'
       ORDER BY sa.sale_date DESC, sa.sale_id DESC`,
      [customerId],
    )
    return response.json({ success: true, data: credits })
  } catch (error) {
    console.error('Unable to retrieve customer credits:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer credits' })
  }
}

export async function getCustomerPayments(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [payments] = await pool.execute(
      `SELECT pa.payment_id, pa.sale_id, pa.payment_amount, pa.remaining_balance,
              CONCAT(DATE_FORMAT(pa.payment_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS payment_date,
              u.fullname AS recorded_by
       FROM payments pa JOIN users u ON pa.user_id = u.user_id
       WHERE pa.customer_id = ?
       ORDER BY pa.payment_date DESC, pa.payment_id DESC`,
      [customerId],
    )
    return response.json({ success: true, data: payments })
  } catch (error) {
    console.error('Unable to retrieve customer payments:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer payments' })
  }
}
