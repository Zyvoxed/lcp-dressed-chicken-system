import pool from '../config/database.js'
import { DecimalValidationError, decimalLimits, parseDecimal } from '../utils/decimalValidation.js'
import {
  findIdempotentResponse,
  getIdempotencyKey,
  hashRequestPayload,
  IdempotencyError,
  readIdempotentResponse,
  reserveIdempotencyKey,
  saveIdempotentResponse,
} from '../utils/idempotency.js'
import { centsToAmount, toCents } from '../utils/money.js'
import { resolveTransactionFailure } from '../utils/transactionFailure.js'

class PaymentError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function recordPayment(request, response) {
  let connection
  let idempotency
  let transactionBeginAttempted = false
  let transactionStarted = false
  let commitAttempted = false
  let commitCompleted = false
  let connectionReusable = true

  try {
    const idempotencyKey = getIdempotencyKey(request)
    const saleId = Number(request.body?.sale_id)
    if (!Number.isInteger(saleId) || saleId <= 0) throw new PaymentError(400, 'Invalid sale ID')
    let paymentAmount
    try {
      paymentAmount = parseDecimal(request.body?.payment_amount, {
        fieldName: 'Payment amount',
        maximum: decimalLimits.money,
        decimalPlaces: 2,
        minimum: 0,
        inclusiveMinimum: false,
      })
    } catch (error) {
      if (error instanceof DecimalValidationError) throw new PaymentError(400, error.message)
      throw error
    }

    const paymentCents = toCents(paymentAmount)
    idempotency = {
      userId: request.user.user_id,
      operation: 'payment',
      key: idempotencyKey,
      payloadHash: hashRequestPayload({
        sale_id: saleId,
        payment_amount_cents: paymentCents.toString(),
      }),
    }

    connection = await pool.getConnection()
    transactionBeginAttempted = true
    await connection.beginTransaction()
    transactionStarted = true
    await reserveIdempotencyKey(connection, idempotency)

    const [sales] = await connection.execute(
      `SELECT customer_id, payment_type, total_amount, amount_paid, remaining_balance, status
       FROM sales WHERE sale_id = ? LIMIT 1 FOR UPDATE`,
      [saleId],
    )
    const sale = sales[0]

    if (!sale) throw new PaymentError(404, 'Sale not found')
    if (sale.payment_type !== 'Credit' || !sale.customer_id) throw new PaymentError(400, 'Payments can only be recorded for customer credit sales')

    const saleOutstandingCents = toCents(sale.remaining_balance)
    if (saleOutstandingCents <= 0n) throw new PaymentError(400, 'This sale is already fully paid')
    if (paymentCents > saleOutstandingCents) throw new PaymentError(400, 'Payment exceeds the outstanding balance')

    const [customers] = await connection.execute(
      'SELECT current_balance FROM customers WHERE customer_id = ? LIMIT 1 FOR UPDATE',
      [sale.customer_id],
    )
    if (!customers[0]) throw new PaymentError(404, 'Customer not found')
    if (toCents(customers[0].current_balance) < paymentCents) {
      throw new PaymentError(409, 'The customer balance does not match this payment. Please contact the owner.')
    }

    const newPaid = centsToAmount(toCents(sale.amount_paid) + paymentCents)
    const newRemainingCents = saleOutstandingCents - paymentCents
    const newRemaining = centsToAmount(newRemainingCents)
    const paymentValue = centsToAmount(paymentCents)
    const status = newRemainingCents === 0n ? 'Paid' : 'Partially Paid'

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
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'PAYMENT_RECORDED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Payment ${result.insertId} recorded for sale ${saleId} (${paymentValue})`],
    )

    const resultBody = {
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment_id: result.insertId,
        sale_id: saleId,
        payment_amount: paymentValue,
        remaining_balance: newRemaining,
        status,
      },
    }
    await saveIdempotentResponse(connection, { ...idempotency, status: 201, body: resultBody })
    commitAttempted = true
    await connection.commit()
    commitCompleted = true
    return response.status(201).json(resultBody)
  } catch (error) {
    const rejectionConfirmed = (error instanceof PaymentError || error instanceof IdempotencyError)
      && error.status < 500
    const failure = await resolveTransactionFailure({
      connection,
      transactionBeginAttempted,
      transactionStarted,
      commitAttempted,
      commitCompleted,
      error,
      operation: 'payment',
      rejectionConfirmed,
    })
    connectionReusable = failure.reusable
    if (error.code === 'ER_DUP_ENTRY' && idempotency) {
      if (failure.outcome === 'unknown') {
        return response.status(500).json({
          success: false,
          code: 'TRANSACTION_OUTCOME_UNKNOWN',
          transaction_outcome: 'unknown',
          message: 'Unable to confirm payment status. Check transaction status before retrying.',
        })
      }
      try {
        const record = await findIdempotentResponse(pool, idempotency)
        const replay = readIdempotentResponse(record, idempotency.payloadHash)
        if (replay.kind === 'payload-mismatch') {
          return response.status(409).json({
            success: false,
            code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
            transaction_outcome: 'not_committed',
            message: 'Idempotency key was already used for a different request',
          })
        }
        if (replay.kind === 'replay') return response.status(replay.status).json(replay.body)
      } catch (replayError) {
        console.error('Unable to retrieve idempotent payment result:', replayError.message)
        return response.status(500).json({ success: false, message: 'Unable to record payment' })
      }
    }
    if ((error instanceof PaymentError || error instanceof IdempotencyError) && failure.outcome === 'not_committed') {
      return response.status(error.status).json({
        success: false,
        code: rejectionConfirmed ? 'TRANSACTION_REJECTED' : 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: failure.outcome,
        message: error.message,
      })
    }
    console.error('Unable to record payment:', error.code || 'UNKNOWN')
    return response.status(500).json({
      success: false,
      code: 'TRANSACTION_OUTCOME_UNKNOWN',
      transaction_outcome: 'unknown',
      message: 'Unable to record payment',
    })
  } finally {
    if (connectionReusable) connection?.release()
  }
}
