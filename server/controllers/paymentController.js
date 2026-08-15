import pool from '../config/database.js'

class PaymentError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function recordPayment(request, response) {
  let connection

  try {
    const saleId = Number(request.body?.sale_id)
    const paymentAmount = Number(request.body?.payment_amount)
    const validPaymentType = typeof request.body?.payment_amount === 'number' || typeof request.body?.payment_amount === 'string'

    if (!Number.isInteger(saleId) || saleId <= 0) throw new PaymentError(400, 'Invalid sale ID')
    if (!validPaymentType || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      throw new PaymentError(400, 'Payment amount must be greater than zero')
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()

    const [sales] = await connection.execute(
      `SELECT customer_id, payment_type, total_amount, amount_paid, remaining_balance, status
       FROM sales WHERE sale_id = ? LIMIT 1 FOR UPDATE`,
      [saleId],
    )
    const sale = sales[0]

    if (!sale) throw new PaymentError(404, 'Sale not found')
    if (sale.payment_type !== 'Credit' || !sale.customer_id) throw new PaymentError(400, 'Payments apply only to customer Credit sales')

    const outstandingCents = Math.round(Number(sale.remaining_balance) * 100)
    const paymentCents = Math.round(paymentAmount * 100)
    if (outstandingCents <= 0) throw new PaymentError(400, 'This sale is already fully paid')
    if (paymentCents > outstandingCents) throw new PaymentError(400, 'Payment exceeds the outstanding balance')

    const [customers] = await connection.execute(
      'SELECT current_balance FROM customers WHERE customer_id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE',
      [sale.customer_id],
    )
    if (!customers[0]) throw new PaymentError(404, 'Active customer not found')
    if (Math.round(Number(customers[0].current_balance) * 100) < paymentCents) {
      throw new PaymentError(409, 'Customer balance is inconsistent with this payment')
    }

    const newPaid = (Number(sale.amount_paid) + paymentCents / 100).toFixed(2)
    const newRemainingCents = outstandingCents - paymentCents
    const newRemaining = (newRemainingCents / 100).toFixed(2)
    const paymentValue = (paymentCents / 100).toFixed(2)
    const status = newRemainingCents === 0 ? 'Paid' : 'Partially Paid'

    await connection.execute(
      'UPDATE sales SET amount_paid = ?, remaining_balance = ?, status = ? WHERE sale_id = ?',
      [newPaid, newRemaining, status, saleId],
    )
    await connection.execute(
      'UPDATE customers SET current_balance = current_balance - ? WHERE customer_id = ?',
      [paymentValue, sale.customer_id],
    )
    const [result] = await connection.execute(
      `INSERT INTO payments (sale_id, customer_id, user_id, payment_amount, remaining_balance, payment_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [saleId, sale.customer_id, request.user.user_id, paymentValue, newRemaining, new Date()],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description)
       VALUES (?, 'PAYMENT_RECORDED', ?)`,
      [request.user.user_id, `Payment ${result.insertId} recorded for sale ${saleId} (${paymentValue})`],
    )

    await connection.commit()
    return response.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment_id: result.insertId,
        sale_id: saleId,
        payment_amount: paymentValue,
        remaining_balance: newRemaining,
        status,
      },
    })
  } catch (error) {
    if (connection) await connection.rollback()
    if (error instanceof PaymentError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to record payment:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to record payment' })
  } finally {
    connection?.release()
  }
}
