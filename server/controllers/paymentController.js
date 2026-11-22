import pool from '../config/database.js'
import { DecimalValidationError, decimalLimits, parseDecimal } from '../utils/decimalValidation.js'
import {
  getIdempotencyKey,
  hashRequestPayload,
  IdempotencyError,
  IdempotencyKeyConflictError,
  reserveIdempotencyKey,
  resolveIdempotencyReplay,
  saveIdempotentResponse,
} from '../utils/idempotency.js'
import { centsToAmount, toCents } from '../utils/money.js'
import { toManilaDateTime } from '../utils/manilaDateTime.js'
import { resolveTransactionFailure } from '../utils/transactionFailure.js'

class PaymentError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function normalizePaymentRequest(request) {
  const idempotencyKey = getIdempotencyKey(request)
  const saleId = Number(request.body?.sale_id)
  if (!Number.isInteger(saleId) || saleId <= 0) throw new PaymentError(400, 'Invalid sale ID')

  // Validate the submitted amount at the supported scale, then use cents for all payment math.
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
  // Hash normalized cents so equivalent decimal spellings share the same retry identity.
  const idempotency = {
    userId: request.user.user_id,
    operation: 'payment',
    key: idempotencyKey,
    payloadHash: hashRequestPayload({
      sale_id: saleId,
      payment_amount_cents: paymentCents.toString(),
    }),
  }

  return { saleId, paymentCents, idempotency }
}

async function lockCreditSale(connection, saleId) {
  const [sales] = await connection.execute(
    `SELECT customer_id, payment_type, total_amount, amount_paid, remaining_balance, status
     FROM sales WHERE sale_id = ? LIMIT 1 FOR UPDATE`,
    [saleId],
  )
  const sale = sales[0]

  if (!sale) throw new PaymentError(404, 'Sale not found')
  if (sale.payment_type !== 'Credit' || !sale.customer_id) {
    throw new PaymentError(400, 'Payments can only be recorded for customer credit sales')
  }

  return sale
}

function validateSaleOutstanding(sale, paymentCents) {
  const outstandingCents = toCents(sale.remaining_balance)
  if (outstandingCents <= 0n) throw new PaymentError(400, 'This sale is already fully paid')
  if (paymentCents > outstandingCents) throw new PaymentError(400, 'Payment exceeds the outstanding balance')
  return outstandingCents
}

async function lockAndValidateCustomerBalance(connection, customerId, paymentCents) {
  const [customers] = await connection.execute(
    'SELECT current_balance FROM customers WHERE customer_id = ? LIMIT 1 FOR UPDATE',
    [customerId],
  )
  if (!customers[0]) throw new PaymentError(404, 'Customer not found')
  if (toCents(customers[0].current_balance) < paymentCents) {
    throw new PaymentError(409, 'The customer balance does not match this payment. Please contact the owner.')
  }
}

function calculatePaymentAmounts(sale, outstandingCents, paymentCents) {
  // A partial amount reduces this sale's balance; only a zero remainder transitions it to Paid.
  const newPaid = centsToAmount(toCents(sale.amount_paid) + paymentCents)
  const newRemainingCents = outstandingCents - paymentCents
  const newRemaining = centsToAmount(newRemainingCents)
  const paymentValue = centsToAmount(paymentCents)
  const status = newRemainingCents === 0n ? 'Paid' : 'Partially Paid'
  return { newPaid, newRemaining, paymentValue, status }
}

async function persistPayment(connection, { saleId, customerId, userId, amounts }) {
  // The payment belongs to one credit sale; update both ledgers and history atomically in this order.
  await connection.execute(
    'UPDATE sales SET amount_paid = ?, remaining_balance = ?, status = ? WHERE sale_id = ?',
    [amounts.newPaid, amounts.newRemaining, amounts.status, saleId],
  )
  await connection.execute(
    'UPDATE customers SET current_balance = current_balance - ? WHERE customer_id = ?',
    [amounts.paymentValue, customerId],
  )
  const [result] = await connection.execute(
    `INSERT INTO payments (sale_id, customer_id, user_id, payment_amount, remaining_balance, payment_date)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [saleId, customerId, userId, amounts.paymentValue, amounts.newRemaining, toManilaDateTime()],
  )
  await connection.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, 'PAYMENT_RECORDED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [userId, `Payment ${result.insertId} recorded for sale ${saleId} (${amounts.paymentValue})`],
  )

  return result.insertId
}

function buildPaymentResponse(paymentId, saleId, amounts) {
  return {
    success: true,
    message: 'Payment recorded successfully',
    data: {
      payment_id: paymentId,
      sale_id: saleId,
      payment_amount: amounts.paymentValue,
      remaining_balance: amounts.newRemaining,
      status: amounts.status,
    },
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
    const paymentRequest = normalizePaymentRequest(request)
    const { saleId, paymentCents } = paymentRequest
    idempotency = paymentRequest.idempotency

    connection = await pool.getConnection()
    transactionBeginAttempted = true
    await connection.beginTransaction()
    transactionStarted = true
    // Reserve before financial writes; only a completed matching response can be replayed.
    await reserveIdempotencyKey(connection, idempotency)

    // Lock sale before customer so concurrent payments see serialized outstanding totals.
    const sale = await lockCreditSale(connection, saleId)
    const saleOutstandingCents = validateSaleOutstanding(sale, paymentCents)

    // Check the customer ledger while locked before changing either outstanding balance.
    await lockAndValidateCustomerBalance(connection, sale.customer_id, paymentCents)
    const amounts = calculatePaymentAmounts(sale, saleOutstandingCents, paymentCents)

    // Sale totals, customer balance, payment history, activity, and replay response
    // remain in one transaction so failures cannot leave them out of sync.
    const paymentId = await persistPayment(connection, {
      saleId,
      customerId: sale.customer_id,
      userId: request.user.user_id,
      amounts,
    })

    const resultBody = buildPaymentResponse(paymentId, saleId, amounts)
    await saveIdempotentResponse(connection, { ...idempotency, status: 201, body: resultBody })
    // Save the response before commit so a completed payment can be replayed safely.
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
    if (error instanceof IdempotencyKeyConflictError && idempotency) {
      try {
        const replay = await resolveIdempotencyReplay(pool, idempotency)
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
      }
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm payment status. Check transaction status before retrying.',
      })
    }

    if (error.code === 'ER_DUP_ENTRY' && idempotency) {
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm payment status. Check transaction status before retrying.',
      })
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
