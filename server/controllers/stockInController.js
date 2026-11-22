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
import { centsToAmount, lineTotalCents, toCents, toThousandths } from '../utils/money.js'
import { resolveTransactionFailure } from '../utils/transactionFailure.js'
import {
  getBusinessCalendarDate,
  getStockInCalendarDate,
  STOCK_IN_FUTURE_DATE_MESSAGE,
  STOCK_IN_INVALID_DATE_MESSAGE,
} from '../../shared/stockInDate.js'

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function parsePositiveInteger(value, fieldName) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RequestError(400, `${fieldName} must be a positive integer`)
  }

  return parsed
}

function decimalValue(value, options) {
  try {
    return parseDecimal(value, options)
  } catch (error) {
    if (error instanceof DecimalValidationError) throw new RequestError(400, error.message)
    throw error
  }
}

function prepareStockInRequest(request) {
  const idempotencyKey = getIdempotencyKey(request)
  const supplierId = parsePositiveInteger(request.body?.supplier_id, 'Supplier')
  const productId = parsePositiveInteger(request.body?.product_id, 'Product')
  const quantityReceived = decimalValue(request.body?.quantity_received, {
    fieldName: 'Quantity received',
    maximum: decimalLimits.quantity,
    decimalPlaces: 3,
    minimum: 0,
    inclusiveMinimum: false,
  })
  const costPrice = decimalValue(request.body?.cost_price, {
    fieldName: 'Cost price',
    maximum: decimalLimits.unitPrice,
    decimalPlaces: 2,
    minimum: 0,
  })
  const submittedDeliveryDate = request.body?.delivery_date
  const deliveryCalendarDate = getStockInCalendarDate(submittedDeliveryDate)
  if (!deliveryCalendarDate) throw new RequestError(400, STOCK_IN_INVALID_DATE_MESSAGE)
  if (deliveryCalendarDate > getBusinessCalendarDate()) {
    throw new RequestError(400, STOCK_IN_FUTURE_DATE_MESSAGE)
  }
  const deliveryDate = new Date(submittedDeliveryDate)
  const costPriceCents = toCents(costPrice)
  const idempotency = {
    userId: request.user.user_id,
    operation: 'stock_in',
    key: idempotencyKey,
    payloadHash: hashRequestPayload({
      supplier_id: supplierId,
      product_id: productId,
      quantity_thousandths: toThousandths(quantityReceived).toString(),
      cost_price_cents: costPriceCents.toString(),
      delivery_date: String(request.body.delivery_date),
    }),
  }

  const quantityValue = quantityReceived.toFixed(3)
  const costValue = centsToAmount(costPriceCents)
  const totalCostCents = lineTotalCents(quantityReceived, costPrice)
  if (totalCostCents > BigInt(Math.round(decimalLimits.money * 100))) {
    throw new RequestError(400, `Total cost must not exceed ${decimalLimits.money}`)
  }

  return {
    supplierId,
    productId,
    quantityReceived,
    quantityValue,
    costValue,
    totalCost: centsToAmount(totalCostCents),
    deliveryDate,
    idempotency,
  }
}

async function lockActiveSupplier(connection, supplierId) {
  const [suppliers] = await connection.execute(
    'SELECT supplier_id FROM suppliers WHERE supplier_id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE',
    [supplierId],
  )
  if (suppliers.length === 0) throw new RequestError(404, 'Active supplier not found')
}

async function lockActiveProduct(connection, productId) {
  const [products] = await connection.execute(
    `SELECT product_id, stock_quantity, reorder_level
     FROM products
     WHERE product_id = ? AND is_active = TRUE
     LIMIT 1
     FOR UPDATE`,
    [productId],
  )
  if (products.length === 0) throw new RequestError(404, 'Active product not found')
  return products[0]
}

function calculateInventoryStatus(product, quantityReceived) {
  const newStock = Number(product.stock_quantity) + quantityReceived
  if (!Number.isFinite(newStock) || newStock > decimalLimits.quantity) {
    throw new RequestError(400, `Resulting product stock must not exceed ${decimalLimits.quantity}`)
  }

  const reorderLevel = Number(product.reorder_level)
  const status = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'
  return status
}

async function persistStockIn(connection, request, stockIn) {
  // Stock-in history gets the selected product's configured unit through product_id; FIFO uses each batch's cost, date, and balance.
  const [result] = await connection.execute(
    `INSERT INTO stock_in (
       supplier_id,
       product_id,
       user_id,
       quantity_received,
       remaining_quantity,
       cost_price,
       total_cost,
       delivery_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stockIn.supplierId,
      stockIn.productId,
      request.user.user_id,
      stockIn.quantityValue,
      stockIn.quantityValue,
      stockIn.costValue,
      stockIn.totalCost,
      stockIn.deliveryDate,
    ],
  )

  await connection.execute(
    'UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?',
    [stockIn.quantityValue, stockIn.productId],
  )
  await connection.execute(
    'UPDATE products SET status = ? WHERE product_id = ?',
    [stockIn.status, stockIn.productId],
  )
  await connection.execute(
    `INSERT INTO activity_logs (user_id, action, description, created_at)
     VALUES (?, 'STOCK_IN_CREATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
    [request.user.user_id, `Stock-In ${result.insertId} created for product ${stockIn.productId}`],
  )

  return result.insertId
}

function buildStockInResponse(stockInId, stockIn) {
  return {
    success: true,
    message: 'Stock-in recorded successfully',
    data: {
      stockin_id: stockInId,
      supplier_id: stockIn.supplierId,
      product_id: stockIn.productId,
      quantity_received: stockIn.quantityValue,
      remaining_quantity: stockIn.quantityValue,
      cost_price: stockIn.costValue,
      total_cost: stockIn.totalCost,
    },
  }
}

export async function createStockIn(request, response) {
  let connection
  let idempotency
  let transactionBeginAttempted = false
  let transactionStarted = false
  let commitAttempted = false
  let commitCompleted = false
  let connectionReusable = true

  try {
    const stockIn = prepareStockInRequest(request)
    idempotency = stockIn.idempotency

    connection = await pool.getConnection()
    // Reserve the idempotency key and perform all stock-in writes in the same
    // transaction so a failed batch insert cannot leave aggregate stock incremented.
    transactionBeginAttempted = true
    await connection.beginTransaction()
    transactionStarted = true
    await reserveIdempotencyKey(connection, idempotency)

    // Lock referenced active records so archiving or other stock updates cannot race
    // validation and the product quantity/status change.
    await lockActiveSupplier(connection, stockIn.supplierId)
    const product = await lockActiveProduct(connection, stockIn.productId)
    stockIn.status = calculateInventoryStatus(product, stockIn.quantityReceived)

    // Batch history and aggregate inventory update together; supplier_id remains the historical reference.
    const stockInId = await persistStockIn(connection, request, stockIn)
    const resultBody = buildStockInResponse(stockInId, stockIn)
    await saveIdempotentResponse(connection, { ...idempotency, status: 201, body: resultBody })
    // Commit the batch, aggregate inventory, activity entry, and replay record together.
    commitAttempted = true
    await connection.commit()
    commitCompleted = true

    return response.status(201).json(resultBody)
  } catch (error) {
    const rejectionConfirmed = (error instanceof RequestError || error instanceof IdempotencyError)
      && error.status < 500
    const failure = await resolveTransactionFailure({
      connection,
      transactionBeginAttempted,
      transactionStarted,
      commitAttempted,
      commitCompleted,
      error,
      operation: 'stock-in',
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
        console.error('Unable to retrieve idempotent stock-in result:', replayError.message)
      }
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm stock delivery status. Check transaction status before retrying.',
      })
    }

    if (error.code === 'ER_DUP_ENTRY' && idempotency) {
      return response.status(500).json({
        success: false,
        code: 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: 'unknown',
        message: 'Unable to confirm stock delivery status. Check transaction status before retrying.',
      })
    }

    if ((error instanceof RequestError || error instanceof IdempotencyError) && failure.outcome === 'not_committed') {
      return response.status(error.status).json({
        success: false,
        code: rejectionConfirmed ? 'TRANSACTION_REJECTED' : 'TRANSACTION_OUTCOME_UNKNOWN',
        transaction_outcome: failure.outcome,
        message: error.message,
      })
    }

    console.error('Unable to record stock-in:', error.code || 'UNKNOWN')
    return response.status(500).json({
      success: false,
      code: 'TRANSACTION_OUTCOME_UNKNOWN',
      transaction_outcome: 'unknown',
      message: 'Unable to record stock-in',
    })
  } finally {
    if (connectionReusable) connection?.release()
  }
}

export async function getStockInRecords(request, response) {
  try {
    const [records] = await pool.execute(`
      SELECT
          si.stockin_id,
          si.supplier_id,
          s.supplier_name,
          si.product_id,
          p.product_name,
          p.unit,
          si.user_id,
          u.fullname AS recorded_by,
          si.quantity_received,
          si.remaining_quantity,
          si.cost_price,
          si.total_cost,
          CONCAT(DATE_FORMAT(si.delivery_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS delivery_date,
          si.created_at
      FROM stock_in si
      JOIN suppliers s
          ON si.supplier_id = s.supplier_id
      JOIN products p
          ON si.product_id = p.product_id
      JOIN users u
          ON si.user_id = u.user_id
      ORDER BY si.delivery_date DESC, si.stockin_id DESC;
    `)

    return response.json({
      success: true,
      data: records,
    })
  } catch (error) {
    console.error('Unable to retrieve stock-in records:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to retrieve stock-in records',
    })
  }
}

export async function getStockInBatchAllocations(request, response) {
  try {
    const stockInId = parsePositiveInteger(request.params.id, 'Batch')
    const [batches] = await pool.execute(
      `SELECT
          si.stockin_id,
          si.supplier_id,
          s.supplier_name,
          si.product_id,
          p.product_name,
          p.unit,
          si.quantity_received,
          si.remaining_quantity,
          si.cost_price,
          si.total_cost,
          CONCAT(DATE_FORMAT(si.delivery_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS delivery_date,
          u.fullname AS recorded_by
       FROM stock_in si
       JOIN suppliers s ON si.supplier_id = s.supplier_id
       JOIN products p ON si.product_id = p.product_id
       JOIN users u ON si.user_id = u.user_id
       WHERE si.stockin_id = ?
       LIMIT 1`,
      [stockInId],
    )

    if (!batches[0]) {
      return response.status(404).json({ success: false, message: 'Stock-in batch not found' })
    }

    const [allocations] = await pool.execute(
      `SELECT allocation_id, sale_id, salesitem_id, stockin_id,
              quantity_deducted, cost_price, sale_date, allocation_order
       FROM (
         SELECT sba.allocation_id,
                sa.sale_id,
                item.salesitem_id,
                sba.stockin_id,
                sba.quantity_deducted,
                sba.cost_price,
                CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
                ROW_NUMBER() OVER (
                  PARTITION BY item.salesitem_id
                  ORDER BY batch.delivery_date ASC, batch.stockin_id ASC
                ) AS allocation_order
         FROM sale_batch_allocations sba
         JOIN sales_items item ON sba.salesitem_id = item.salesitem_id
         JOIN sales sa ON item.sale_id = sa.sale_id
         JOIN stock_in batch ON sba.stockin_id = batch.stockin_id
       ) allocation_history
       WHERE stockin_id = ?
       ORDER BY sale_date DESC, allocation_id DESC`,
      [stockInId],
    )

    return response.json({
      success: true,
      data: {
        batch: batches[0],
        allocations,
      },
    })
  } catch (error) {
    if (error instanceof RequestError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }

    console.error('Unable to retrieve stock-in batch allocations:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve stock-in batch allocations' })
  }
}
