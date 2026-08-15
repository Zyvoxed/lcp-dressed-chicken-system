import pool from '../config/database.js'

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

function numericValue(value, label, minimum, inclusive = true) {
  const parsed = Number(value)
  const validType = typeof value === 'number' || typeof value === 'string'
  const empty = typeof value === 'string' && value.trim() === ''
  const validRange = inclusive ? parsed >= minimum : parsed > minimum

  if (!validType || empty || !Number.isFinite(parsed) || !validRange) {
    throw new SaleError(400, `${label} is invalid`)
  }
  return parsed
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new SaleError(400, 'At least one sale item is required')
  }

  const productIds = new Set()
  const normalized = items.map((item) => {
    const productId = positiveInteger(item?.product_id, 'Product')
    const quantity = numericValue(item?.quantity, 'Quantity', 0, false)

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

  try {
    const paymentType = request.body?.payment_type
    if (paymentType !== 'Cash' && paymentType !== 'Credit') {
      throw new SaleError(400, 'Payment type must be Cash or Credit')
    }

    const amountPaid = numericValue(request.body?.amount_paid, 'Amount paid', 0)
    const items = normalizeItems(request.body?.items)
    const hasCustomer = request.body?.customer_id !== null && request.body?.customer_id !== undefined && request.body?.customer_id !== ''
    const customerId = hasCustomer ? positiveInteger(request.body.customer_id, 'Customer') : null

    if (paymentType === 'Credit' && !customerId) {
      throw new SaleError(400, 'A customer is required for credit sales')
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()

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
    let totalCents = 0

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
        throw new SaleError(409, `Insufficient inventory for product ${item.productId}`)
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
        throw new SaleError(409, `Insufficient FIFO inventory for product ${item.productId}`)
      }

      const priceCents = Math.round(Number(product.selling_price) * 100)
      const subtotalCents = Math.round(item.quantity * priceCents)
      totalCents += subtotalCents
      preparedItems.push({ ...item, product, batches, priceCents, subtotalCents })
    }

    const amountPaidCents = Math.round(amountPaid * 100)
    if (amountPaidCents > totalCents) {
      throw new SaleError(400, 'Amount paid cannot exceed the sale total')
    }
    if (paymentType === 'Cash' && amountPaidCents < totalCents) {
      throw new SaleError(400, 'Cash payment must cover the full sale total')
    }

    const remainingCents = totalCents - amountPaidCents
    const status = remainingCents === 0 ? 'Paid' : amountPaidCents > 0 ? 'Partially Paid' : 'Unpaid'
    const totalAmount = (totalCents / 100).toFixed(2)
    const paidAmount = (amountPaidCents / 100).toFixed(2)
    const remainingBalance = (remainingCents / 100).toFixed(2)

    const [saleResult] = await connection.execute(
      `INSERT INTO sales (
         customer_id, user_id, payment_type, total_amount,
         amount_paid, remaining_balance, status, sale_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [customerId, request.user.user_id, paymentType, totalAmount, paidAmount, remainingBalance, status, new Date()],
    )

    for (const item of preparedItems) {
      const quantity = item.quantity.toFixed(3)
      const price = (item.priceCents / 100).toFixed(2)
      const subtotal = (item.subtotalCents / 100).toFixed(2)
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
      `INSERT INTO activity_logs (user_id, action, description)
       VALUES (?, 'SALE_CREATED', ?)`,
      [request.user.user_id, `Sale ${saleResult.insertId} created (${paymentType}, ${totalAmount})`],
    )

    await connection.commit()

    return response.status(201).json({
      success: true,
      message: 'Sale recorded successfully',
      data: {
        sale_id: saleResult.insertId,
        total_amount: totalAmount,
        amount_paid: paidAmount,
        remaining_balance: remainingBalance,
        status,
      },
    })
  } catch (error) {
    if (connection) await connection.rollback()

    if (error instanceof SaleError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }

    console.error('Unable to record sale:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to record sale' })
  } finally {
    connection?.release()
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
