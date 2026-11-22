import pool from '../config/database.js'

const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const manilaCurrentDate = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))"

function manilaCalendar() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year').value)
  const monthLabel = parts.find((part) => part.type === 'month').value
  const month = new Date(`${monthLabel} 1, ${year} 00:00:00 UTC`).getUTCMonth() + 1

  return {
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    monthLabel,
  }
}

function fillSeries(length, rows, indexField, labelForIndex) {
  // Database rows contain only non-empty buckets; a Map lets the fixed calendar series
  // be filled in one pass without searching the rows for every label.
  const values = new Map(rows.map((row) => [Number(row[indexField]), row]))
  return Array.from({ length }, (_, index) => ({
    label: labelForIndex(index),
    sales: values.get(index) ? Number(values.get(index).sales) : 0,
    transactions: values.get(index) ? Number(values.get(index).transactions) : 0,
  }))
}

async function getStaffDashboardData() {
  const [summaryRows] = await pool.execute(`
    SELECT
      (SELECT COUNT(*) FROM sales
       WHERE sale_date >= ${manilaCurrentDate}
         AND sale_date < ${manilaCurrentDate} + INTERVAL 1 DAY) AS today_transactions,
      (SELECT COALESCE(SUM(current_balance), 0) FROM customers
       WHERE is_active = TRUE) AS outstanding_credits
  `)
  const [recentTransactions] = await pool.execute(`
    SELECT transaction_type, reference_id, customer_name, status, occurred_at
    FROM (
      SELECT 'Sale' AS transaction_type, sa.sale_id AS reference_id,
             COALESCE(c.customer_name, 'Walk-In Customer') AS customer_name,
             sa.status,
             CONCAT(DATE_FORMAT(sa.sale_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS occurred_at
      FROM sales sa
      LEFT JOIN customers c ON c.customer_id = sa.customer_id
      UNION ALL
      SELECT 'Payment' AS transaction_type, pa.payment_id AS reference_id,
             c.customer_name,
             'Recorded' AS status,
             CONCAT(DATE_FORMAT(pa.payment_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS occurred_at
      FROM payments pa
      JOIN customers c ON c.customer_id = pa.customer_id
    ) transactions
    ORDER BY occurred_at DESC, reference_id DESC
    LIMIT 10
  `)
  const [lowStock] = await pool.execute(`
    SELECT product_id, product_name, unit, stock_quantity, reorder_level, status
    FROM products WHERE is_active = TRUE AND stock_quantity <= reorder_level
    ORDER BY stock_quantity ASC, product_name ASC LIMIT 10
  `)
  const [todayQuantityByUnit] = await pool.execute(`
    SELECT p.unit, SUM(si.quantity) AS total_quantity
    FROM sales_items si JOIN sales sa ON sa.sale_id = si.sale_id
    JOIN products p ON p.product_id = si.product_id
    WHERE sa.sale_date >= ${manilaCurrentDate}
      AND sa.sale_date < ${manilaCurrentDate} + INTERVAL 1 DAY
    GROUP BY p.unit ORDER BY p.unit
  `)
  const [recentStockIn] = await pool.execute(`
    SELECT si.stockin_id, s.supplier_name, p.product_name, p.unit,
           si.quantity_received,
           CONCAT(DATE_FORMAT(si.delivery_date, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS delivery_date
    FROM stock_in si JOIN suppliers s ON s.supplier_id = si.supplier_id
    JOIN products p ON p.product_id = si.product_id
    ORDER BY si.delivery_date DESC, si.stockin_id DESC LIMIT 5
  `)

  return {
    summary: summaryRows[0],
    recent_transactions: recentTransactions,
    low_stock_alerts: lowStock,
    recent_stock_in: recentStockIn,
    today_quantity_by_unit: todayQuantityByUnit,
  }
}

async function getAdminDashboardData() {
  const [summaries] = await pool.execute(`
    SELECT
      (SELECT COALESCE(SUM(total_amount), 0) FROM sales) AS total_revenue,
      (SELECT COUNT(*) FROM sales) AS total_transactions,
      (SELECT COALESCE(AVG(total_amount), 0) FROM sales) AS average_sale_value,
      (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS total_products,
      (SELECT COUNT(*) FROM products WHERE is_active = TRUE AND stock_quantity <= reorder_level) AS low_stock_count,
      (SELECT COALESCE(SUM(current_balance), 0) FROM customers WHERE is_active = TRUE) AS customer_credits
  `)
  const [topProducts] = await pool.execute(`
    SELECT product_id, product_name, unit, quantity_sold, sales_amount, unit_rank
    FROM (
      SELECT p.product_id, p.product_name, p.unit,
             SUM(si.quantity) AS quantity_sold, SUM(si.subtotal) AS sales_amount,
             ROW_NUMBER() OVER (
               PARTITION BY p.unit
               ORDER BY SUM(si.quantity) DESC, SUM(si.subtotal) DESC, p.product_name ASC
             ) AS unit_rank
      FROM sales_items si
      JOIN products p ON si.product_id = p.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
    ) AS ranked_products
    WHERE unit_rank <= 5
    ORDER BY unit ASC, unit_rank ASC
  `)
  const [lowProducts] = await pool.execute(`
    SELECT product_id, product_name, unit, stock_quantity, quantity_sold, unit_rank
    FROM (
      SELECT p.product_id, p.product_name, p.unit, p.stock_quantity,
             COALESCE(SUM(si.quantity), 0) AS quantity_sold,
             ROW_NUMBER() OVER (
               PARTITION BY p.unit
               ORDER BY COALESCE(SUM(si.quantity), 0) ASC, p.product_name ASC
             ) AS unit_rank
      FROM products p
      LEFT JOIN sales_items si ON p.product_id = si.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
    ) AS ranked_products
    WHERE unit_rank <= 5
    ORDER BY unit ASC, unit_rank ASC
  `)
  const [lowStock] = await pool.execute(`
    SELECT product_id, product_name, unit, stock_quantity, reorder_level, status
    FROM products
    WHERE is_active = TRUE AND stock_quantity <= reorder_level
    ORDER BY stock_quantity ASC, product_name ASC
  `)
  const [activities] = await pool.execute(`
    SELECT al.activity_id, al.action, al.description,
           CONCAT(DATE_FORMAT(al.created_at, '%Y-%m-%dT%H:%i:%s'), '+08:00') AS created_at,
           COALESCE(u.fullname, 'System') AS operator_name,
           COALESCE(u.username, 'system') AS username,
           COALESCE(u.role, 'System') AS role
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.user_id
    ORDER BY al.created_at DESC, al.activity_id DESC
    LIMIT 5
  `)
  // SQL aggregates in Manila-time buckets; fillSeries adds empty hours and days for chart continuity.
  const [dailyRows] = await pool.execute(`
    SELECT HOUR(sale_date) AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
    FROM sales
    WHERE sale_date >= ${manilaCurrentDate}
      AND sale_date < ${manilaCurrentDate} + INTERVAL 1 DAY
    GROUP BY HOUR(sale_date)
    ORDER BY bucket_index
  `)
  const [weeklyRows] = await pool.execute(`
    SELECT WEEKDAY(sale_date) AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
    FROM sales
    WHERE sale_date >= DATE_SUB(${manilaCurrentDate}, INTERVAL WEEKDAY(${manilaCurrentDate}) DAY)
      AND sale_date < DATE_ADD(DATE_SUB(${manilaCurrentDate}, INTERVAL WEEKDAY(${manilaCurrentDate}) DAY), INTERVAL 7 DAY)
    GROUP BY WEEKDAY(sale_date)
    ORDER BY bucket_index
  `)
  const [monthlyRows] = await pool.execute(`
    SELECT DAY(sale_date) - 1 AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
    FROM sales
    WHERE sale_date >= DATE_FORMAT(${manilaCurrentDate}, '%Y-%m-01')
      AND sale_date < DATE_FORMAT(${manilaCurrentDate}, '%Y-%m-01') + INTERVAL 1 MONTH
    GROUP BY DAY(sale_date) - 1
    ORDER BY bucket_index
  `)

  const { daysInMonth, monthLabel } = manilaCalendar()
  return {
    summary: {
      ...summaries[0],
      best_seller: topProducts
        .filter((product) => Number(product.unit_rank) === 1)
        .map((product) => `${product.product_name} (${product.unit})`)
        .join(' · ') || null,
    },
    trends: {
      daily: fillSeries(24, dailyRows, 'bucket_index', (index) => `${String(index).padStart(2, '0')}:00`),
      weekly: fillSeries(7, weeklyRows, 'bucket_index', (index) => dayLabels[index]),
      monthly: fillSeries(daysInMonth, monthlyRows, 'bucket_index', (index) => `${monthLabel} ${index + 1}`),
    },
    top_products: topProducts,
    low_products: lowProducts,
    low_stock_alerts: lowStock,
    recent_activity: activities,
  }
}

function manilaDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftCalendarDate(dateKey, offset) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export async function getStaffSalesActivity(request, response) {
  try {
    const today = manilaDateKey(new Date())
    const startDate = shiftCalendarDate(today, -6)
    const endDate = shiftCalendarDate(today, 1)
    const [rows] = await pool.execute(`
      SELECT DATE_FORMAT(sale_date, '%Y-%m-%d') AS sale_day,
             COUNT(DISTINCT sale_id) AS transaction_count
      FROM sales
      WHERE sale_date >= ? AND sale_date < ?
      GROUP BY sale_day
      ORDER BY sale_day ASC
    `, [startDate, endDate])
    const countsByDate = new Map(rows.map((row) => [row.sale_day, Number(row.transaction_count)]))
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = shiftCalendarDate(startDate, index)
      return { date, transactions: countsByDate.get(date) || 0 }
    })
    return response.json({ success: true, data: { days } })
  } catch (error) {
    console.error('Unable to retrieve staff sales activity:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve sales activity' })
  }
}

export async function getDashboard(request, response) {
  try {
    // Keep role-specific datasets separate so each response exposes only its established metrics.
    const data = request.user?.role === 'Staff'
      ? await getStaffDashboardData()
      : await getAdminDashboardData()
    return response.json({ success: true, data })
  } catch (error) {
    console.error('Unable to retrieve dashboard analytics:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve dashboard analytics' })
  }
}

export function rankBusinessProducts(products) {
  // Quantity order is meaningful only within a configured unit, so each unit gets its own ranks.
  const groupedByUnit = new Map()
  for (const product of products) {
    const unit = product.unit || 'Unspecified unit'
    if (!groupedByUnit.has(unit)) groupedByUnit.set(unit, [])
    groupedByUnit.get(unit).push(product)
  }
  const unitGroups = [...groupedByUnit.entries()].sort(([left], [right]) => left.localeCompare(right))
  const topPerforming = []
  const slowSelling = []
  const topPerUnit = []
  const slowPerUnit = []

  for (const [, unitProducts] of unitGroups) {
    const byQuantityDescending = [...unitProducts].sort((left, right) => (
      Number(right.quantity_sold) - Number(left.quantity_sold)
      || Number(right.gross_sales) - Number(left.gross_sales)
      || left.product_name.localeCompare(right.product_name)
    ))
    const byQuantityAscending = [...unitProducts].sort((left, right) => (
      Number(left.quantity_sold) - Number(right.quantity_sold)
      || left.product_name.localeCompare(right.product_name)
    ))
    const top = byQuantityDescending.filter((product) => Number(product.quantity_sold) > 0).slice(0, 5)
    const slow = byQuantityAscending.slice(0, 5)
    top.forEach((product, index) => topPerforming.push({ ...product, unit_rank: index + 1 }))
    slow.forEach((product, index) => slowSelling.push({ ...product, unit_rank: index + 1 }))
    if (top[0]) topPerUnit.push({ ...top[0], unit_rank: 1 })
    if (slow[0]) slowPerUnit.push({ ...slow[0], unit_rank: 1 })
  }

  const restockAlerts = products
    .filter((product) => Number(product.current_stock) <= Number(product.reorder_level))
    .sort((left, right) => {
      const leftRatio = Number(left.reorder_level) > 0 ? Number(left.current_stock) / Number(left.reorder_level) : Number(left.current_stock)
      const rightRatio = Number(right.reorder_level) > 0 ? Number(right.current_stock) / Number(right.reorder_level) : Number(right.current_stock)
      return leftRatio - rightRatio || left.product_name.localeCompare(right.product_name)
    })

  return { topPerforming, slowSelling, restockAlerts, topPerUnit, slowPerUnit }
}

export async function getBusinessAnalytics(request, response) {
  try {
    const [summaryRows] = await pool.execute(`
      SELECT COUNT(sale_id) AS total_transactions,
             COALESCE(SUM(total_amount), 0) AS gross_revenue,
             COALESCE(AVG(total_amount), 0) AS average_ticket_value
      FROM sales
    `)
    const [products] = await pool.execute(`
      SELECT p.product_id, p.product_name, p.unit,
             p.stock_quantity AS current_stock, p.reorder_level,
             COALESCE(SUM(si.quantity), 0) AS quantity_sold,
             COALESCE(SUM(si.subtotal), 0) AS gross_sales
      FROM products p
      LEFT JOIN sales_items si ON si.product_id = p.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
      ORDER BY p.unit ASC, quantity_sold DESC, gross_sales DESC, p.product_name ASC
    `)
    const { topPerforming, slowSelling, restockAlerts, topPerUnit, slowPerUnit } = rankBusinessProducts(products)

    return response.json({
      success: true,
      data: {
        summary: { ...summaryRows[0], top_seller: null, top_sellers_by_unit: topPerUnit },
        product_performance: products,
        top_performing: topPerforming,
        slow_selling: slowSelling,
        restock_alerts: restockAlerts,
        insights: {
          sales_driver: null,
          lagging_product: null,
          sales_drivers_by_unit: topPerUnit,
          lagging_products_by_unit: slowPerUnit,
          procurement_priority: restockAlerts[0] || null,
        },
      },
    })
  } catch (error) {
    console.error('Unable to retrieve business analytics:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve business analytics' })
  }
}
