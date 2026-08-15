import pool from '../config/database.js'

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
