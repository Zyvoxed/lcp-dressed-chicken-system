import pool from '../config/database.js'

function parseCustomerId(value) {
  const customerId = Number(value)
  return Number.isInteger(customerId) && customerId > 0 ? customerId : null
}

export async function getCustomers(request, response) {
  try {
    const [customers] = await pool.execute(`
      SELECT customer_id, customer_name, contact_number, address, current_balance, created_at
      FROM customers
      WHERE is_active = TRUE
      ORDER BY customer_name ASC
    `)
    return response.json({ success: true, data: customers })
  } catch (error) {
    console.error('Unable to retrieve customers:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customers' })
  }
}

export async function createCustomer(request, response) {
  const customerName = typeof request.body?.customer_name === 'string' ? request.body.customer_name.trim() : ''
  const contactNumber = typeof request.body?.contact_number === 'string' ? request.body.contact_number.trim() || null : null
  const address = typeof request.body?.address === 'string' ? request.body.address.trim() || null : null

  if (!customerName) {
    return response.status(400).json({ success: false, message: 'Customer name is required' })
  }

  try {
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
    console.error('Unable to create customer:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to create customer' })
  }
}

export async function getCustomer(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [customers] = await pool.execute(
      `SELECT customer_id, customer_name, contact_number, address, current_balance, created_at
       FROM customers WHERE customer_id = ? AND is_active = TRUE LIMIT 1`,
      [customerId],
    )
    if (!customers[0]) return response.status(404).json({ success: false, message: 'Customer not found' })
    return response.json({ success: true, data: customers[0] })
  } catch (error) {
    console.error('Unable to retrieve customer:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve customer' })
  }
}

export async function getCustomerCredits(request, response) {
  const customerId = parseCustomerId(request.params.id)
  if (!customerId) return response.status(400).json({ success: false, message: 'Invalid customer ID' })

  try {
    const [credits] = await pool.execute(
      `SELECT sa.sale_id, sa.sale_date, sa.total_amount, sa.amount_paid,
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
              pa.payment_date, u.fullname AS recorded_by
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
