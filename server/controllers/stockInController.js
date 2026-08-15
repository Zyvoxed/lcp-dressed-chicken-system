import pool from '../config/database.js'

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

function parseNumber(value, fieldName, minimum, inclusive = true) {
  const parsed = Number(value)
  const validRange = inclusive ? parsed >= minimum : parsed > minimum

  if (value === '' || value === null || value === undefined || !Number.isFinite(parsed) || !validRange) {
    throw new RequestError(400, `${fieldName} is invalid`)
  }

  return parsed
}

export async function createStockIn(request, response) {
  let connection

  try {
    const supplierId = parsePositiveInteger(request.body?.supplier_id, 'Supplier')
    const productId = parsePositiveInteger(request.body?.product_id, 'Product')
    const quantityReceived = parseNumber(request.body?.quantity_received, 'Quantity received', 0, false)
    const costPrice = parseNumber(request.body?.cost_price, 'Cost price', 0)
    const deliveryDate = new Date(request.body?.delivery_date)

    if (!request.body?.delivery_date || Number.isNaN(deliveryDate.getTime())) {
      throw new RequestError(400, 'Delivery date is invalid')
    }

    const quantityValue = quantityReceived.toFixed(3)
    const costValue = costPrice.toFixed(2)
    const totalCost = (quantityReceived * costPrice).toFixed(2)

    connection = await pool.getConnection()
    await connection.beginTransaction()

    const [suppliers] = await connection.execute(
      'SELECT supplier_id FROM suppliers WHERE supplier_id = ? AND is_active = TRUE LIMIT 1',
      [supplierId],
    )

    if (suppliers.length === 0) {
      throw new RequestError(404, 'Active supplier not found')
    }

    const [products] = await connection.execute(
      `SELECT product_id, stock_quantity, reorder_level
       FROM products
       WHERE product_id = ? AND is_active = TRUE
       LIMIT 1
       FOR UPDATE`,
      [productId],
    )

    if (products.length === 0) {
      throw new RequestError(404, 'Active product not found')
    }

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
        supplierId,
        productId,
        request.user.user_id,
        quantityValue,
        quantityValue,
        costValue,
        totalCost,
        deliveryDate,
      ],
    )

    await connection.execute(
      'UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?',
      [quantityValue, productId],
    )

    const newStock = Number(products[0].stock_quantity) + quantityReceived
    const reorderLevel = Number(products[0].reorder_level)
    const status = newStock <= 0 ? 'Out of Stock' : newStock <= reorderLevel ? 'Low Stock' : 'Available'

    await connection.execute(
      'UPDATE products SET status = ? WHERE product_id = ?',
      [status, productId],
    )

    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description)
       VALUES (?, 'STOCK_IN_CREATED', ?)`,
      [request.user.user_id, `Stock-In ${result.insertId} created for product ${productId}`],
    )

    await connection.commit()

    return response.status(201).json({
      success: true,
      message: 'Stock-in recorded successfully',
      data: {
        stockin_id: result.insertId,
        supplier_id: supplierId,
        product_id: productId,
        quantity_received: quantityValue,
        remaining_quantity: quantityValue,
        cost_price: costValue,
        total_cost: totalCost,
      },
    })
  } catch (error) {
    if (connection) {
      await connection.rollback()
    }

    if (error instanceof RequestError) {
      return response.status(error.status).json({
        success: false,
        message: error.message,
      })
    }

    console.error('Unable to record stock-in:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to record stock-in',
    })
  } finally {
    connection?.release()
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
          si.delivery_date,
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
