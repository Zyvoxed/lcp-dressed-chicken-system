import pool from '../config/database.js'

function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const pageSize = query.page_size === undefined ? 25 : Number(query.page_size)
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid page size')
  const offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid page')
  return { page, pageSize, offset }
}

function dateFilters(query, column) {
  const clauses = []
  const parameters = []
  for (const [field, operator] of [['start_date', '>=' ], ['end_date', '<']]) {
    const value = query[field]
    if (!value) continue
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    const calendarDate = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    if (!calendarDate || calendarDate.getUTCFullYear() !== Number(match[1])
      || calendarDate.getUTCMonth() !== Number(match[2]) - 1
      || calendarDate.getUTCDate() !== Number(match[3])) {
      throw new Error(`Invalid ${field.replace('_', ' ')}`)
    }
    clauses.push(operator === '<' ? `${column} < DATE_ADD(?, INTERVAL 1 DAY)` : `${column} >= ?`)
    parameters.push(`${value} 00:00:00`)
  }
  if (query.start_date && query.end_date && query.start_date > query.end_date) {
    throw new Error('Start date cannot be after end date')
  }
  return { clauses, parameters }
}

function searchTerm(query) {
  const value = typeof query.search === 'string' ? query.search.trim() : ''
  if (value.length > 100) throw new Error('Invalid search text')
  return value
}

function pageData(page, total) {
  return { page: page.page, page_size: page.pageSize, total_records: total, total_pages: Math.ceil(total / page.pageSize) }
}

export async function getOperationalReport(request, response) {
  const report = request.params.report
  if (!['sales', 'inventory', 'stock-in', 'receivables'].includes(report)) {
    return response.status(404).json({ success: false, message: 'Operational report not found' })
  }

  try {
    const page = pagination(request.query)
    const search = searchTerm(request.query)
    const pageParams = [String(page.pageSize), String(page.offset)]
    let records
    let total
    let summary = null

    if (report === 'sales') {
      const dates = dateFilters(request.query, 'sa.sale_date')
      const filters = [...dates.clauses]
      const params = [...dates.parameters]
      if (request.query.payment_type) {
        if (!['Cash', 'Credit'].includes(request.query.payment_type)) throw new Error('Invalid payment type')
        filters.push('sa.payment_type = ?')
        params.push(request.query.payment_type)
      }
      if (request.query.status) {
        if (!['Paid', 'Partially Paid', 'Unpaid'].includes(request.query.status)) throw new Error('Invalid status')
        filters.push('sa.status = ?')
        params.push(request.query.status)
      }
      if (search) {
        filters.push(`(CAST(sa.sale_id AS CHAR) LIKE ? OR c.customer_name LIKE ? OR u.fullname LIKE ?
          OR EXISTS (SELECT 1 FROM sales_items search_items
                     JOIN products search_products ON search_products.product_id = search_items.product_id
                     WHERE search_items.sale_id = sa.sale_id AND search_products.product_name LIKE ?))`)
        params.push(...Array(4).fill(`%${search}%`))
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM sales sa
         LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id ${where}`,
        params,
      )
      const [rows] = await pool.execute(
        `SELECT sa.sale_id,
                CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
                COALESCE(c.customer_name, 'Walk-In Customer') AS customer_name,
                sa.payment_type, sa.status,
                COALESCE(items.item_count, 0) AS item_count
         FROM sales sa
         LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id
         LEFT JOIN (SELECT sale_id, COUNT(*) AS item_count
                    FROM sales_items GROUP BY sale_id) items ON items.sale_id = sa.sale_id
         ${where}
         ORDER BY sa.sale_date DESC, sa.sale_id DESC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      const [totals] = await pool.execute(
        `SELECT COUNT(*) AS transaction_count
         FROM sales sa LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id ${where}`,
        params,
      )
      const [quantityByUnit] = await pool.execute(
        `SELECT p.unit, COALESCE(SUM(si.quantity), 0) AS total_quantity
         FROM sales sa JOIN sales_items si ON si.sale_id = sa.sale_id
         JOIN products p ON p.product_id = si.product_id
         LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id ${where}
         GROUP BY p.unit ORDER BY p.unit`,
        params,
      )
      const saleIds = rows.map((row) => Number(row.sale_id))
      let quantitiesBySale = new Map()
      let productsBySale = new Map()
      if (saleIds.length > 0) {
        const placeholders = saleIds.map(() => '?').join(', ')
        const [saleQuantities] = await pool.execute(
          `SELECT si.sale_id, p.unit, SUM(si.quantity) AS total_quantity
           FROM sales_items si JOIN products p ON p.product_id = si.product_id
           WHERE si.sale_id IN (${placeholders})
           GROUP BY si.sale_id, p.unit ORDER BY si.sale_id, p.unit`,
          saleIds,
        )
        quantitiesBySale = new Map()
        for (const item of saleQuantities) {
          const saleId = Number(item.sale_id)
          const quantities = quantitiesBySale.get(saleId) || []
          quantities.push({ unit: item.unit, total_quantity: item.total_quantity })
          quantitiesBySale.set(saleId, quantities)
        }
        const [saleProducts] = await pool.execute(
          `SELECT si.sale_id, p.product_name, p.unit, SUM(si.quantity) AS quantity_sold
           FROM sales_items si JOIN products p ON p.product_id = si.product_id
           WHERE si.sale_id IN (${placeholders})
           GROUP BY si.sale_id, p.product_id, p.product_name, p.unit
           ORDER BY si.sale_id, p.product_name, p.unit`,
          saleIds,
        )
        for (const item of saleProducts) {
          const saleId = Number(item.sale_id)
          const products = productsBySale.get(saleId) || []
          products.push({ product_name: item.product_name, unit: item.unit, quantity_sold: item.quantity_sold })
          productsBySale.set(saleId, products)
        }
      }
      records = rows.map((row) => ({
        ...row,
        quantity_by_unit: quantitiesBySale.get(Number(row.sale_id)) || [],
        products_sold: productsBySale.get(Number(row.sale_id)) || [],
      }))
      total = Number(counts[0]?.total_records || 0)
      summary = { ...totals[0], quantity_by_unit: quantityByUnit }
    } else if (report === 'inventory') {
      const where = search ? `AND (product_name LIKE ? OR category LIKE ? OR unit LIKE ?)` : ''
      const params = search ? Array(3).fill(`%${search}%`) : []
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM products WHERE is_active = TRUE ${where}`,
        params,
      )
      const [rows] = await pool.execute(
        `SELECT product_id, product_name, category, unit, stock_quantity, reorder_level, status
         FROM products WHERE is_active = TRUE ${where}
         ORDER BY product_name ASC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      const [totals] = await pool.execute(`
        SELECT COUNT(*) AS active_products,
               SUM(stock_quantity <= reorder_level) AS low_stock_products,
               SUM(status = 'Out of Stock') AS out_of_stock_products
        FROM products WHERE is_active = TRUE
      `)
      const [byUnit] = await pool.execute(`
        SELECT unit, SUM(stock_quantity) AS total_quantity
        FROM products WHERE is_active = TRUE GROUP BY unit ORDER BY unit
      `)
      records = rows
      total = Number(counts[0]?.total_records || 0)
      summary = { ...totals[0], quantity_by_unit: byUnit }
    } else if (report === 'stock-in') {
      const dates = dateFilters(request.query, 'si.delivery_date')
      const filters = [...dates.clauses]
      const params = [...dates.parameters]
      if (search) {
        filters.push('(CAST(si.stockin_id AS CHAR) LIKE ? OR s.supplier_name LIKE ? OR p.product_name LIKE ?)')
        params.push(...Array(3).fill(`%${search}%`))
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM stock_in si
         JOIN suppliers s ON s.supplier_id = si.supplier_id
         JOIN products p ON p.product_id = si.product_id ${where}`,
        params,
      )
      const [rows] = await pool.execute(
        `SELECT si.stockin_id, s.supplier_name,
                p.product_name, p.unit, si.quantity_received,
                CONCAT(DATE_FORMAT(si.delivery_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS delivery_date
         FROM stock_in si JOIN suppliers s ON s.supplier_id = si.supplier_id
         JOIN products p ON p.product_id = si.product_id
         ${where} ORDER BY si.delivery_date DESC, si.stockin_id DESC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      records = rows
      total = Number(counts[0]?.total_records || 0)
    } else {
      const where = search ? 'AND (customer_name LIKE ? OR CAST(customer_id AS CHAR) LIKE ?)' : ''
      const params = search ? Array(2).fill(`%${search}%`) : []
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total_records FROM customers
         WHERE is_active = TRUE AND current_balance > 0 ${where}`,
        params,
      )
      const [rows] = await pool.execute(
        `SELECT customer_id, customer_name, current_balance
         FROM customers WHERE is_active = TRUE AND current_balance > 0 ${where}
         ORDER BY current_balance DESC, customer_name ASC LIMIT ? OFFSET ?`,
        [...params, ...pageParams],
      )
      const [totals] = await pool.execute(`
        SELECT COUNT(*) AS customers_with_balance, COALESCE(SUM(current_balance), 0) AS total_receivables
        FROM customers WHERE is_active = TRUE AND current_balance > 0
      `)
      records = rows
      total = Number(counts[0]?.total_records || 0)
      summary = totals[0]
    }

    return response.json({ success: true, data: { report, summary, records, pagination: pageData(page, total) } })
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Start date')) {
      return response.status(400).json({ success: false, message: error.message })
    }
    console.error('Unable to retrieve operational report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve operational report' })
  }
}
