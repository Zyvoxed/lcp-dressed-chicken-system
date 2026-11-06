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
import { centsToAmount, lineTotalCents, toCents, toThousandths } from '../utils/money.js'
import { resolveTransactionFailure } from '../utils/transactionFailure.js'

class SaleError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function positiveInteger(value, label) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SaleError(400, `${label} must be a positive integer`)
  }
  return parsed
}

function decimalValue(value, options) {
  try {
    return parseDecimal(value, options)
  } catch (error) {
    if (error instanceof DecimalValidationError) throw new SaleError(400, error.message)
    throw error
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new SaleError(400, 'At least one sale item is required')
  }

  const productIds = new Set()
  const normalized = items.map((item) => {
    if (['price', 'selling_price', 'unit_price', 'subtotal'].some((field) => Object.hasOwn(item || {}, field))) {
      throw new SaleError(400, 'Sale item prices are determined by the registered product price')
    }
    const productId = positiveInteger(item?.product_id, 'Product')
    const quantity = decimalValue(item?.quantity, {
      fieldName: 'Quantity',
      maximum: decimalLimits.quantity,
      decimalPlaces: 3,
      minimum: 0,
      inclusiveMinimum: false,
    })

    if (productIds.has(productId)) {
      throw new SaleError(400, 'Duplicate products are not allowed')
    }
    productIds.add(productId)

    return { productId, quantity }
  })

  return normalized.sort((left, right) => left.productId - right.productId)
}

export async function createSale(request, response) {
  let connection
  let idempotency
  let transactionBeginAttempted = false
  let transactionStarted = false
  let commitAttempted = false
  let commitCompleted = false
  let connectionReusable = true

  try {
    const idempotencyKey = getIdempotencyKey(request)
    const paymentType = request.body?.payment_type
    if (paymentType !== 'Cash' && paymentType !== 'Credit') {
      throw new SaleError(400, 'Payment type must be Cash or Credit')
    }

    const amountPaid = decimalValue(request.body?.amount_paid, {
      fieldName: 'Amount paid',
      maximum: decimalLimits.money,
      decimalPlaces: 2,
      minimum: 0,
    })
    const items = normalizeItems(request.body?.items)
    const hasCustomer = request.body?.customer_id !== null && request.body?.customer_id !== undefined && request.body?.customer_id !== ''
    const customerId = hasCustomer ? positiveInteger(request.body.customer_id, 'Customer') : null

    if (paymentType === 'Credit' && !customerId) {
      throw new SaleError(400, 'A customer is required for credit sales')
    }

    const amountPaidCents = toCents(amountPaid)
    idempotency = {
      userId: request.user.user_id,
      operation: 'sale',
      key: idempotencyKey,
      payloadHash: hashRequestPayload({
        payment_type: paymentType,
        customer_id: customerId,
        amount_paid_cents: amountPaidCents.toString(),
        items: items.map((item) => ({
          product_id: item.productId,
          quantity_thousandths: toThousandths(item.quantity).toString(),
        })),
      }),
    }

    connection = await pool.getConnection()
    transactionBeginAttempted = true
    await connection.beginTransaction()
    transactionStarted = true
    await reserveIdempotencyKey(connection, idempotency)

    if (customerId) {
      const [customers] = await connection.execute(
        'SELECT customer_id FROM customers WHERE customer_id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE',
        [customerId],
      )
      if (customers.length === 0) {
        throw new SaleError(404, 'Active customer not found')
      }
    }

    const preparedItems = []
    let totalCents = 0n

    for (const item of items) {
      const [products] = await connection.execute(
        `SELECT product_id, selling_price, stock_quantity, reorder_level
         FROM products
         WHERE product_id = ? AND is_active = TRUE
         LIMIT 1
         FOR UPDATE`,
        [item.productId],
      )
      const product = products[0]

      if (!product) {
        throw new SaleError(404, 'Active product not found')
      }

      if (Number(product.stock_quantity) < item.quantity) {
        throw new SaleError(409, `Not enough stock for product ${item.productId}`)
      }

      const [batches] = await connection.execute(
        `SELECT stockin_id, remaining_quantity, cost_price, delivery_date
         FROM stock_in
         WHERE product_id = ? AND remaining_quantity > 0
         ORDER BY delivery_date ASC, stockin_id ASC
         FOR UPDATE`,
        [item.productId],
      )
      const fifoAvailable = batches.reduce((sum, batch) => sum + Number(batch.remaining_quantity), 0)

      if (fifoAvailable < item.quantity) {
        throw new SaleError(409, `Available stock records do not cover product ${item.productId}. Please contact the owner.`)
      }

      const priceCents = toCents(product.selling_price)
      const subtotalCents = lineTotalCents(item.quantity, product.selling_price)
      const maximumMoneyCents = BigInt(Math.round(decimalLimits.money * 100))
      if (subtotalCents > maximumMoneyCents) {
        throw new SaleError(400, `Sale item total must not exceed ${decimalLimits.money}`)
      }
      totalCents += subtotalCents
      if (totalCents > maximumMoneyCents) {
        throw new SaleError(400, `Sale total must not exceed ${decimalLimits.money}`)
      }
      preparedItems.push({ ...item, product, batches, priceCents, subtotalCents })
    }

    if (amountPaidCents > totalCents) {
      throw new SaleError(400, 'Amount paid cannot exceed the sale total')
    }
    if (paymentType === 'Cash' && amountPaidCents < totalCents) {
      throw new SaleError(400, 'Cash payment must cover the full sale total')
    }

    const remainingCents = totalCents - amountPaidCents
    const status = remainingCents === 0n ? 'Paid' : amountPaidCents > 0n ? 'Partially Paid' : 'Unpaid'
    const totalAmount = centsToAmount(totalCents)
    const paidAmount = centsToAmount(amountPaidCents)
    const remainingBalance = centsToAmount(remainingCents)

    const [saleResult] = await connection.execute(
      `INSERT INTO sales (
         customer_id, user_id, payment_type, total_amount,
         amount_paid, remaining_balance, status, sale_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [customerId, request.user.user_id, paymentType, totalAmount, paidAmount, remainingBalance, status],
    )

    for (const item of preparedItems) {
      const quantity = item.quantity.toFixed(3)
      const price = centsToAmount(item.priceCents)
      const subtotal = centsToAmount(item.subtotalCents)
      const [itemResult] = await connection.execute(
        `INSERT INTO sales_items (sale_id, product_id, quantity, price, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        [saleResult.insertId, item.productId, quantity, price, subtotal],
      )

      let quantityRemaining = item.quantity
      for (const batch of item.batches) {
        if (quantityRemaining <= 0) break

        const deduction = Math.min(quantityRemaining, Number(batch.remaining_quantity))
        const deductionValue = deduction.toFixed(3)

        await connection.execute(
          'UPDATE stock_in SET remaining_quantity = remaining_quantity - ? WHERE stockin_id = ?',
          [deductionValue, batch.stockin_id],
        )
        await connection.execute(
          `INSERT INTO sale_batch_allocations (salesitem_id, stockin_id, quantity_deducted, cost_price)
           VALUES (?, ?, ?, ?)`,
          [itemResult.insertId, batch.stockin_id, deductionValue, batch.cost_price],
        )
        quantityRemaining = Number((quantityRemaining - deduction).toFixed(3))
      }

      await connection.execute(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?',
        [quantity, item.productId],
      )

      const newStock = Number(item.product.stock_quantity) - item.quantity
      const reorderLevel = Number(item.product.reorder_level)
      const productStatus = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'
      await connection.execute('UPDATE products SET status = ? WHERE product_id = ?', [productStatus, item.productId])
    }

    if (paymentType === 'Credit' && remainingCents > 0) {
      await connection.execute(
        'UPDATE customers SET current_balance = current_balance + ? WHERE customer_id = ?',
        [remainingBalance, customerId],
      )
    }

    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'SALE_CREATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Sale ${saleResult.insertId} created (${paymentType}, ${totalAmount})`],
    )

    const resultBody = {
      success: true,
      message: 'Sale recorded successfully',
      data: {
        sale_id: saleResult.insertId,
        total_amount: totalAmount,
        amount_paid: paidAmount,
        remaining_balance: remainingBalance,
        status,
      },
    }
    await saveIdempotentResponse(connection, { ...idempotency, status: 201, body: resultBody })
    commitAttempted = true
    await connection.commit()
    commitCompleted = true

    return response.status(201).json(resultBody)
  } catch (error) {
    const rejectionConfirmed = (error instanceof SaleError || error instanceof IdempotencyError)
      && error.status < 500
    const failure = await resolveTransactionFailure({
      connection,
      transactionBeginAttempted,
      transactionStarted,
      commitAttempted,
      commitCompleted,
      error,
      operation: 'sale',
      rejectionConfirmed,
    })
    connectionReusable = failure.reusable

    if (error.code === 'ER_DUP_ENTRY' && idempotency) {
      if (failure.outcome === 'unknown') {
        return response.status(500).json({
          success: false,
          code: 'TRANSACTION_OUTCOME_UNKNOWN',
          transaction_outcome: 'unknown',
          message: 'Unable to confirm sale status. Check transaction status before retrying.',
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
        console.error('Unable to retrieve idempotent sale result:', replayError.message)
        return response.status(500).json({ success: false, message: 'Unable to record sale' })
      }
    }

    if ((error instanceof SaleError || error instanceof IdempotencyError) && failure.outcome === 'not_committed') {
      return response.status(error.status).json({
        success: false,
        code: rejectionConfirmed ? 'TRANSACTION_REJECTED' : 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: failure.outcome,
        message: error.message,
      })
    }

    console.error('Unable to record sale:', error.code || 'UNKNOWN')
    return response.status(500).json({
      success: false,
      code: 'TRANSACTION_OUTCOME_UNKNOWN',
      transaction_outcome: 'unknown',
      message: 'Unable to record sale',
    })
  } finally {
    if (connectionReusable) connection?.release()
  }
}

export async function getSales(request, response) {
  try {
    const [sales] = await pool.execute(`
      SELECT
          sa.sale_id,
          sa.sale_date,
          c.customer_name,
          u.fullname AS recorded_by,
          sa.payment_type,
          sa.total_amount,
          sa.amount_paid,
          sa.remaining_balance,
          sa.status
      FROM sales sa
      LEFT JOIN customers c ON sa.customer_id = c.customer_id
      JOIN users u ON sa.user_id = u.user_id
      ORDER BY sa.sale_date DESC, sa.sale_id DESC;
    `)

    return response.json({ success: true, data: sales })
  } catch (error) {
    console.error('Unable to retrieve sales:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve sales' })
  }
}
