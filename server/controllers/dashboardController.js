import pool from '../config/database.js'

const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function fillSeries(length, rows, indexField, labelForIndex) {
  const values = new Map(rows.map((row) => [Number(row[indexField]), row]))
  return Array.from({ length }, (_, index) => ({
    label: labelForIndex(index),
    sales: values.get(index) ? Number(values.get(index).sales) : 0,
    transactions: values.get(index) ? Number(values.get(index).transactions) : 0,
  }))
}

export async function getDashboard(request, response) {
  try {
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
      SELECT p.product_id, p.product_name, p.unit,
             SUM(si.quantity) AS quantity_sold, SUM(si.subtotal) AS sales_amount
      FROM sales_items si
      JOIN products p ON si.product_id = p.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
      ORDER BY quantity_sold DESC, sales_amount DESC, p.product_name ASC
      LIMIT 5
    `)
    const [lowProducts] = await pool.execute(`
      SELECT p.product_id, p.product_name, p.unit, p.stock_quantity,
             COALESCE(SUM(si.quantity), 0) AS quantity_sold
      FROM products p
      LEFT JOIN sales_items si ON p.product_id = si.product_id
      WHERE p.is_active = TRUE
      GROUP BY p.product_id
      ORDER BY quantity_sold ASC, p.product_name ASC
      LIMIT 5
    `)
    const [lowStock] = await pool.execute(`
      SELECT product_id, product_name, unit, stock_quantity, reorder_level, status
      FROM products
      WHERE is_active = TRUE AND stock_quantity <= reorder_level
      ORDER BY stock_quantity ASC, product_name ASC
    `)
    const [activities] = await pool.execute(`
      SELECT al.activity_id, al.action, al.description, al.created_at,
             COALESCE(u.fullname, 'System') AS operator_name,
             COALESCE(u.username, 'system') AS username,
             COALESCE(u.role, 'System') AS role
      FROM activity_logs al
      LEFT JOIN users u ON al.user_id = u.user_id
      ORDER BY al.created_at DESC, al.activity_id DESC
      LIMIT 5
    `)
    const [dailyRows] = await pool.execute(`
      SELECT HOUR(sale_date) AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
      FROM sales WHERE DATE(sale_date) = CURRENT_DATE()
      GROUP BY HOUR(sale_date)
    `)
    const [weeklyRows] = await pool.execute(`
      SELECT WEEKDAY(sale_date) AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
      FROM sales
      WHERE sale_date >= DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY)
        AND sale_date < DATE_ADD(DATE_SUB(CURRENT_DATE(), INTERVAL WEEKDAY(CURRENT_DATE()) DAY), INTERVAL 7 DAY)
      GROUP BY WEEKDAY(sale_date)
    `)
    const [monthlyRows] = await pool.execute(`
      SELECT DAY(sale_date) - 1 AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
      FROM sales
      WHERE YEAR(sale_date) = YEAR(CURRENT_DATE()) AND MONTH(sale_date) = MONTH(CURRENT_DATE())
      GROUP BY DAY(sale_date)
    `)

    const today = new Date()
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    return response.json({
      success: true,
      data: {
        summary: { ...summaries[0], best_seller: topProducts[0]?.product_name || null },
        trends: {
          daily: fillSeries(24, dailyRows, 'bucket_index', (index) => `${String(index).padStart(2, '0')}:00`),
          weekly: fillSeries(7, weeklyRows, 'bucket_index', (index) => dayLabels[index]),
          monthly: fillSeries(daysInMonth, monthlyRows, 'bucket_index', (index) => `${today.toLocaleString('en-US', { month: 'short' })} ${index + 1}`),
        },
        top_products: topProducts,
        low_products: lowProducts,
        low_stock_alerts: lowStock,
        recent_activity: activities,
      },
    })
  } catch (error) {
    console.error('Unable to retrieve dashboard analytics:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve dashboard analytics' })
  }
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
      ORDER BY quantity_sold DESC, gross_sales DESC, p.product_name ASC
    `)

    const topPerforming = products.filter((product) => Number(product.quantity_sold) > 0).slice(0, 5)
    const slowSelling = [...products]
      .sort((left, right) => Number(left.quantity_sold) - Number(right.quantity_sold) || left.product_name.localeCompare(right.product_name))
      .slice(0, 5)
    const restockAlerts = products
      .filter((product) => Number(product.current_stock) <= Number(product.reorder_level))
      .sort((left, right) => {
        const leftRatio = Number(left.reorder_level) > 0 ? Number(left.current_stock) / Number(left.reorder_level) : Number(left.current_stock)
        const rightRatio = Number(right.reorder_level) > 0 ? Number(right.current_stock) / Number(right.reorder_level) : Number(right.current_stock)
        return leftRatio - rightRatio || left.product_name.localeCompare(right.product_name)
      })

    return response.json({
      success: true,
      data: {
        summary: { ...summaryRows[0], top_seller: topPerforming[0] || null },
        product_performance: products,
        top_performing: topPerforming,
        slow_selling: slowSelling,
        restock_alerts: restockAlerts,
        insights: {
          sales_driver: topPerforming[0] || null,
          lagging_product: slowSelling[0] || null,
          procurement_priority: restockAlerts[0] || null,
        },
      },
    })
  } catch (error) {
    console.error('Unable to retrieve business analytics:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve business analytics' })
  }
}
