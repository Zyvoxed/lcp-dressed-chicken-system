import pool from '../config/database.js'

const storedCategories = new Map([
  ['whole chicken', 'Whole Chicken'],
  ['prime cuts', 'Prime Cuts'],
  ['wings and drumsticks', 'Wings and Drumsticks'],
  ['innards and offal', 'Innards and Offal'],
])

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const editableProductFields = new Set([
  'product_name',
  'category',
  'selling_price',
  'reorder_level',
])

function parseRequiredText(value, fieldName, maximumLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RequestError(`${fieldName} is required`)
  }

  const parsed = value.trim()

  if (parsed.length > maximumLength) {
    throw new RequestError(`${fieldName} must be ${maximumLength} characters or fewer`)
  }

  return parsed
}

function parseNonNegativeNumber(value, fieldName, maximum, decimalPlaces) {
  const isSupportedType = typeof value === 'number' || typeof value === 'string'
  const numericText = isSupportedType ? String(value).trim() : ''
  const parsed = Number(value)

  if (
    !isSupportedType
    || !/^\d+(?:\.\d+)?$/.test(numericText)
    || !Number.isFinite(parsed)
    || parsed < 0
    || parsed > maximum
  ) {
    throw new RequestError(`${fieldName} must be a valid non-negative number`)
  }

  const decimalLength = numericText.split('.')[1]?.length || 0

  if (decimalLength > decimalPlaces) {
    throw new RequestError(`${fieldName} supports up to ${decimalPlaces} decimal places`)
  }

  return parsed.toFixed(decimalPlaces)
}

function parseCategory(value) {
  const category = parseRequiredText(value, 'Category', 50)
  const normalizedCategory = category
    .toLowerCase()
    .replaceAll('&', 'and')
    .replace(/\s+/g, ' ')
  const storedCategory = storedCategories.get(normalizedCategory)

  if (!storedCategory) {
    throw new RequestError('Category is not supported')
  }

  return storedCategory
}

function parseProductId(value) {
  if (!/^\d+$/.test(value)) {
    throw new RequestError('Product ID must be a positive integer')
  }

  const productId = Number(value)

  if (!Number.isSafeInteger(productId) || productId <= 0 || productId > 2147483647) {
    throw new RequestError('Product ID must be a positive integer')
  }

  return productId
}

function getStockStatus(stockQuantity, reorderLevel) {
  if (stockQuantity <= 0) return 'Out of Stock'
  if (stockQuantity <= reorderLevel) return 'Low Stock'
  return 'Available'
}

export async function createProduct(request, response) {
  try {
    const productName = parseRequiredText(request.body?.product_name, 'Product name', 100)
    const category = parseCategory(request.body?.category)
    const unit = parseRequiredText(request.body?.unit, 'Unit', 20)
    const sellingPrice = parseNonNegativeNumber(
      request.body?.selling_price,
      'Selling price',
      99999999.99,
      2,
    )
    const reorderLevel = parseNonNegativeNumber(
      request.body?.reorder_level,
      'Reorder level',
      9999999.999,
      3,
    )

    const [result] = await pool.execute(
      `INSERT INTO products (
         product_name,
         category,
         unit,
         selling_price,
         stock_quantity,
         reorder_level,
         status
       ) VALUES (?, ?, ?, ?, 0.000, ?, 'Out of Stock')`,
      [productName, category, unit, sellingPrice, reorderLevel],
    )

    return response.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: {
        product_id: result.insertId,
        product_name: productName,
        category,
        unit,
        selling_price: sellingPrice,
        stock_quantity: '0.000',
        reorder_level: reorderLevel,
        status: 'Out of Stock',
      },
    })
  } catch (error) {
    if (error instanceof RequestError) {
      return response.status(error.status).json({
        success: false,
        message: error.message,
      })
    }

    console.error('Unable to create product:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to create product',
    })
  }
}

export async function updateProduct(request, response) {
  let connection
  let transactionStarted = false

  try {
    const productId = parseProductId(request.params.id)
    const body = request.body

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new RequestError('A product update is required')
    }

    const submittedFields = Object.keys(body)

    if (submittedFields.length === 0) {
      throw new RequestError('At least one editable product field is required')
    }

    const unsupportedFields = submittedFields.filter((field) => !editableProductFields.has(field))

    if (unsupportedFields.length > 0) {
      throw new RequestError('Only product name, category, selling price, and reorder level can be updated')
    }

    const updates = []
    const values = []
    let parsedReorderLevel

    if (Object.hasOwn(body, 'product_name')) {
      updates.push('product_name = ?')
      values.push(parseRequiredText(body.product_name, 'Product name', 100))
    }

    if (Object.hasOwn(body, 'category')) {
      updates.push('category = ?')
      values.push(parseCategory(body.category))
    }

    if (Object.hasOwn(body, 'selling_price')) {
      updates.push('selling_price = ?')
      values.push(parseNonNegativeNumber(body.selling_price, 'Selling price', 99999999.99, 2))
    }

    if (Object.hasOwn(body, 'reorder_level')) {
      parsedReorderLevel = parseNonNegativeNumber(body.reorder_level, 'Reorder level', 9999999.999, 3)
      updates.push('reorder_level = ?')
      values.push(parsedReorderLevel)
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const [products] = await connection.execute(
      `SELECT product_id, stock_quantity
       FROM products
       WHERE product_id = ? AND is_active = TRUE
       LIMIT 1
       FOR UPDATE`,
      [productId],
    )

    if (products.length === 0) {
      throw new RequestError('Active product not found', 404)
    }

    if (parsedReorderLevel !== undefined) {
      updates.push('status = ?')
      values.push(getStockStatus(Number(products[0].stock_quantity), Number(parsedReorderLevel)))
    }

    await connection.execute(
      `UPDATE products SET ${updates.join(', ')} WHERE product_id = ?`,
      [...values, productId],
    )

    const [updatedProducts] = await connection.execute(
      `SELECT
          product_id,
          product_name,
          category,
          unit,
          selling_price,
          stock_quantity,
          reorder_level,
          status,
          created_at
       FROM products
       WHERE product_id = ?
       LIMIT 1`,
      [productId],
    )

    await connection.commit()
    transactionStarted = false

    return response.json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProducts[0],
    })
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback()
    }

    if (error instanceof RequestError) {
      return response.status(error.status).json({
        success: false,
        message: error.message,
      })
    }

    console.error('Unable to update product:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to update product',
    })
  } finally {
    connection?.release()
  }
}

export async function getProducts(request, response) {
  try {
    const [products] = await pool.query(`
      SELECT
          product_id,
          product_name,
          category,
          unit,
          selling_price,
          stock_quantity,
          reorder_level,
          status,
          created_at
      FROM products
      WHERE is_active = TRUE
      ORDER BY product_name ASC;
    `)

    response.json({
      success: true,
      data: products,
    })
  } catch (error) {
    console.error('Unable to retrieve products:', error.message)
    response.status(500).json({
      success: false,
      message: 'Unable to retrieve products',
    })
  }
}
