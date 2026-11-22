import pool from '../config/database.js'

const reportTypes = new Set(['Sales & Revenue', 'Inventory Valuation', 'Credit Receivables'])

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function salesFilters(query, { includeInteractive = false } = {}) {
  const clauses = []
  const parameters = []

  if (query.start_date) {
    if (!validDate(query.start_date)) throw new Error('Invalid start date')
    clauses.push('sa.sale_date >= ?')
    parameters.push(`${query.start_date} 00:00:00`)
  }
  if (query.end_date) {
    if (!validDate(query.end_date)) throw new Error('Invalid end date')
    clauses.push('sa.sale_date < DATE_ADD(?, INTERVAL 1 DAY)')
    parameters.push(`${query.end_date} 00:00:00`)
  }
  if (query.start_date && query.end_date && query.start_date > query.end_date) {
    throw new Error('Start date cannot be after end date')
  }
  if (query.payment_type) {
    if (!['Cash', 'Credit'].includes(query.payment_type)) throw new Error('Invalid payment type')
    clauses.push('sa.payment_type = ?')
    parameters.push(query.payment_type)
  }
  if (query.user_id) {
    const userId = Number(query.user_id)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Invalid user ID')
    clauses.push('sa.user_id = ?')
    parameters.push(userId)
  }

  const summaryWhere = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const summaryParameters = [...parameters]
  if (includeInteractive && query.status) {
    if (!['Paid', 'Partially Paid', 'Unpaid'].includes(query.status)) throw new Error('Invalid status')
    clauses.push('sa.status = ?')
    parameters.push(query.status)
  }
  if (includeInteractive && query.search) {
    const search = String(query.search).trim()
    if (search.length > 100) throw new Error('Search text must not exceed 100 characters')
    if (search) {
      clauses.push(`(CAST(sa.sale_id AS CHAR) LIKE ? OR CONCAT('OR-', sa.sale_id) LIKE ?
        OR c.customer_name LIKE ? OR u.fullname LIKE ? OR sa.payment_type LIKE ? OR sa.status LIKE ?)`)
      parameters.push(...Array(6).fill(`%${search}%`))
    }
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    parameters,
    summaryWhere,
    summaryParameters,
  }
}

function pagination(query) {
  const page = query.page === undefined ? 1 : Number(query.page)
  const pageSize = query.page_size === undefined ? 25 : Number(query.page_size)
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Invalid page size')
  const offset = (page - 1) * pageSize
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid page')
  return { page, pageSize, offset }
}

export async function getSalesReport(request, response) {
  try {
    const { where, parameters, summaryWhere, summaryParameters } = salesFilters(request.query, { includeInteractive: true })
    const page = pagination(request.query)
    const paginationParams = [String(page.pageSize), String(page.offset)]
    const [records] = await pool.execute(
      `SELECT sa.sale_id,
              sa.customer_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              COALESCE(c.customer_name, 'Walk-In Customer') AS customer_name,
              u.fullname AS recorded_by, sa.payment_type, sa.total_amount,
              sa.amount_paid, sa.remaining_balance, sa.status,
              COALESCE(payment_totals.later_payments_total, 0) AS later_payments_total
       FROM sales sa
       LEFT JOIN customers c ON sa.customer_id = c.customer_id
       JOIN users u ON sa.user_id = u.user_id
       LEFT JOIN (
         SELECT sale_id, SUM(payment_amount) AS later_payments_total
         FROM payments GROUP BY sale_id
       ) payment_totals ON payment_totals.sale_id = sa.sale_id
       ${where}
       ORDER BY sa.sale_date DESC, sa.sale_id DESC
       LIMIT ? OFFSET ?`,
      [...parameters, ...paginationParams],
    )
    const [summaries] = await pool.execute(
      `SELECT COUNT(*) AS total_transactions,
              COALESCE(SUM(sa.total_amount), 0) AS gross_sales,
              COALESCE(SUM(CASE WHEN sa.payment_type = 'Cash' THEN sa.total_amount ELSE 0 END), 0) AS cash_sales_total,
              COALESCE(SUM(CASE WHEN sa.payment_type = 'Credit' THEN sa.total_amount ELSE 0 END), 0) AS credit_sales_total,
              COALESCE(SUM(sa.amount_paid), 0) AS total_amount_paid,
              COALESCE(SUM(sa.remaining_balance), 0) AS outstanding_balance
       FROM sales sa ${summaryWhere}`,
      summaryParameters,
    )
    const [counts] = await pool.execute(
      `SELECT COUNT(*) AS total_records
       FROM sales sa
       LEFT JOIN customers c ON sa.customer_id = c.customer_id
       JOIN users u ON sa.user_id = u.user_id
       ${where}`,
      parameters,
    )
    const totalRecords = Number(counts[0]?.total_records || 0)
    return response.json({
      success: true,
      data: {
        summary: summaries[0],
        records,
        pagination: {
          page: page.page,
          page_size: page.pageSize,
          total_records: totalRecords,
          total_pages: Math.ceil(totalRecords / page.pageSize),
        },
      },
    })
  } catch (error) {
    if (error.message.startsWith('Invalid') || error.message.startsWith('Start date')) {
      return response.status(400).json({ success: false, message: error.message })
    }
    console.error('Unable to generate sales report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate sales report' })
  }
}

export async function getSalesReportDetail(request, response) {
  const saleId = Number(request.params.id)
  if (!Number.isInteger(saleId) || saleId <= 0) {
    return response.status(400).json({ success: false, message: 'Invalid sale ID' })
  }

  try {
    const [sales] = await pool.execute(
      `SELECT sa.sale_id,
              CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS sale_date,
              sa.customer_id,
              COALESCE(c.customer_name, 'Walk-in Customer') AS customer_name,
              c.contact_number, c.address, u.fullname AS recorded_by,
              sa.payment_type, sa.total_amount, sa.amount_paid,
              sa.remaining_balance, sa.status
       FROM sales sa
       LEFT JOIN customers c ON sa.customer_id = c.customer_id
       JOIN users u ON sa.user_id = u.user_id
       WHERE sa.sale_id = ?
       LIMIT 1`,
      [saleId],
    )

    if (!sales[0]) {
      return response.status(404).json({ success: false, message: 'Sale not found' })
    }

    const [items] = await pool.execute(
      `SELECT si.salesitem_id, si.product_id, p.product_name, p.unit,
              si.quantity, si.price, si.subtotal
       FROM sales_items si
       JOIN products p ON si.product_id = p.product_id
       WHERE si.sale_id = ?
       ORDER BY si.salesitem_id ASC`,
      [saleId],
    )
    const [payments] = await pool.execute(
      `SELECT pa.payment_id, pa.payment_amount, pa.remaining_balance,
              CONCAT(DATE_FORMAT(pa.payment_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS payment_date,
              u.fullname AS recorded_by
       FROM payments pa
       JOIN users u ON pa.user_id = u.user_id
       WHERE pa.sale_id = ?
       ORDER BY pa.payment_date ASC, pa.payment_id ASC`,
      [saleId],
    )

    return response.json({
      success: true,
      data: {
        sale: {
          ...sales[0],
          customer_type: sales[0].payment_type === 'Credit' ? 'Credit Supplier' : 'Walk-in',
        },
        items,
        payments,
      },
    })
  } catch (error) {
    console.error('Unable to retrieve sale details:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve sale details' })
  }
}

export async function getInventoryReport(request, response) {
  try {
    const [records] = await pool.execute(`
      SELECT p.product_id, p.product_name, p.category, p.unit, p.stock_quantity,
             p.reorder_level, p.status, p.selling_price,
             COALESCE(SUM(si.remaining_quantity * si.cost_price), 0) AS inventory_cost_value,
             p.stock_quantity * p.selling_price AS estimated_sales_value
      FROM products p
      LEFT JOIN stock_in si ON p.product_id = si.product_id AND si.remaining_quantity > 0
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
      ORDER BY p.product_name ASC
    `)
    const [summaries] = await pool.execute(`
      SELECT COUNT(*) AS total_products,
             COALESCE(SUM(valuation.inventory_cost_value), 0) AS total_inventory_cost_value,
             COALESCE(SUM(valuation.estimated_sales_value), 0) AS estimated_total_sales_value,
             SUM(valuation.status = 'Low Stock') AS low_stock_count,
             SUM(valuation.status = 'Out of Stock') AS out_of_stock_count
      FROM (
        SELECT p.product_id, p.status,
               COALESCE(SUM(si.remaining_quantity * si.cost_price), 0) AS inventory_cost_value,
               p.stock_quantity * p.selling_price AS estimated_sales_value
        FROM products p
        LEFT JOIN stock_in si ON p.product_id = si.product_id AND si.remaining_quantity > 0
        WHERE p.is_active = TRUE
        GROUP BY p.product_id
      ) valuation
    `)
    const [quantityByUnit] = await pool.execute(`
      SELECT unit, SUM(stock_quantity) AS total_quantity
      FROM products WHERE is_active = TRUE GROUP BY unit ORDER BY unit
    `)

    return response.json({
      success: true,
      data: {
        summary: {
          ...summaries[0],
          quantity_by_unit: quantityByUnit,
        },
        records,
      },
    })
  } catch (error) {
    console.error('Unable to generate inventory report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate inventory report' })
  }
}

export async function getReceivablesReport(request, response) {
  try {
    const page = pagination(request.query)
    const paginationParams = [String(page.pageSize), String(page.offset)]
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
    if (search.length > 100) throw new Error('Invalid search text')
    const searchWhere = search
      ? ' AND (customer_name LIKE ? OR contact_number LIKE ? OR address LIKE ?)'
      : ''
    const searchParameters = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    const [counts] = await pool.execute(`
      SELECT COUNT(*) AS total_records
      FROM customers WHERE is_active = TRUE AND current_balance > 0${searchWhere}
    `, searchParameters)
    const [records] = await pool.execute(`
      SELECT c.customer_id, c.customer_name, c.contact_number, c.address, c.current_balance,
             COUNT(sa.sale_id) AS open_credit_sales,
             CONCAT(DATE_FORMAT(MIN(sa.sale_date), '%Y-%m-%dT%H:%i:%s'), '+08:00') AS oldest_unpaid_sale_date,
             COALESCE(SUM(sa.total_amount), 0) AS total_original_credit_amount
      FROM customers c
      LEFT JOIN sales sa ON c.customer_id = sa.customer_id
          AND sa.payment_type = 'Credit' AND sa.remaining_balance > 0
      WHERE c.is_active = TRUE AND c.current_balance > 0${searchWhere.replaceAll('customer_name', 'c.customer_name').replaceAll('contact_number', 'c.contact_number').replaceAll('address', 'c.address')}
      GROUP BY c.customer_id
      ORDER BY c.current_balance DESC, c.customer_name ASC
      LIMIT ? OFFSET ?
    `, [...searchParameters, ...paginationParams])
    const [summaries] = await pool.execute(`
      SELECT COUNT(*) AS customers_with_balance, COALESCE(SUM(current_balance), 0) AS total_receivables
      FROM customers WHERE is_active = TRUE AND current_balance > 0
    `)
    const totalRecords = Number(counts[0]?.total_records || 0)
    return response.json({
      success: true,
      data: {
        summary: summaries[0],
        records,
        pagination: {
          page: page.page,
          page_size: page.pageSize,
          total_records: totalRecords,
          total_pages: Math.ceil(totalRecords / page.pageSize),
        },
      },
    })
  } catch (error) {
    if (error.message.startsWith('Invalid')) return response.status(400).json({ success: false, message: error.message })
    console.error('Unable to generate receivables report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate receivables report' })
  }
}

export async function getProductSalesReport(request, response) {
  const rawIds = typeof request.query.product_ids === 'string' ? request.query.product_ids : ''
  const productIds = rawIds.split(',').filter(Boolean).map(Number)
  if (!productIds.length || productIds.length > 50
    || productIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return response.status(400).json({ success: false, message: 'Select between 1 and 50 valid products' })
  }
  const year = request.query.year ? Number(request.query.year) : null
  if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 9999)) {
    return response.status(400).json({ success: false, message: 'Invalid reporting year' })
  }

  try {
    const yearFilter = year === null ? '' : 'AND YEAR(sa.sale_date) = ?'
    const parameters = year === null ? productIds : [...productIds, year]
    const [records] = await pool.execute(
      `SELECT si.product_id, p.product_name, YEAR(sa.sale_date) AS sale_year,
              MONTH(sa.sale_date) AS sale_month,
              SUM(si.quantity) AS quantity_sold,
              SUM(si.subtotal) AS sales_amount
       FROM sales_items si
       JOIN sales sa ON sa.sale_id = si.sale_id
       JOIN products p ON p.product_id = si.product_id
       WHERE si.product_id IN (${productIds.map(() => '?').join(', ')}) ${yearFilter}
       GROUP BY si.product_id, p.product_name, YEAR(sa.sale_date), MONTH(sa.sale_date)
       ORDER BY sale_year ASC, sale_month ASC, si.product_id ASC`,
      parameters,
    )
    return response.json({ success: true, data: { records } })
  } catch (error) {
    console.error('Unable to generate product sales report:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to generate product sales report' })
  }
}

export async function logReportGeneration(request, response) {
  const reportType = request.body?.report_type
  if (!reportTypes.has(reportType)) {
    return response.status(400).json({ success: false, message: 'Invalid report type' })
  }
  if (reportType === 'Inventory Valuation' && request.user?.role !== 'Admin') {
    return response.status(403).json({ success: false, message: 'Access denied' })
  }

  try {
    const [result] = await pool.execute(
      'INSERT INTO reports (user_id, report_type) VALUES (?, ?)',
      [request.user.user_id, reportType],
    )
    pool.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'REPORT_GENERATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `${reportType} report exported`],
    ).catch((error) => console.error('Unable to record report activity:', error.message))

    return response.status(201).json({ success: true, data: { report_id: result.insertId } })
  } catch (error) {
    console.error('Unable to log report generation:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to log report generation' })
  }
}
