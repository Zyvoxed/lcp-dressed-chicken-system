import pool from '../config/database.js'

export async function getSuppliers(request, response) {
  try {
    const [suppliers] = await pool.execute(`
      SELECT
          supplier_id,
          supplier_name,
          contact_person,
          contact_number,
          address,
          created_at
      FROM suppliers
      WHERE is_active = TRUE
      ORDER BY supplier_name ASC;
    `)

    response.json({
      success: true,
      data: suppliers,
    })
  } catch (error) {
    console.error('Unable to retrieve suppliers:', error.message)
    response.status(500).json({
      success: false,
      message: 'Unable to retrieve suppliers',
    })
  }
}

export async function createSupplier(request, response) {
  const supplierName = request.body.supplier_name?.trim()
  const contactPerson = request.body.contact_person?.trim() || null
  const contactNumber = request.body.contact_number?.trim() || null
  const address = request.body.address?.trim() || null

  if (!supplierName) {
    return response.status(400).json({
      success: false,
      message: 'Supplier name is required',
    })
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO suppliers (supplier_name, contact_person, contact_number, address)
       VALUES (?, ?, ?, ?)`,
      [supplierName, contactPerson, contactNumber, address],
    )

    return response.status(201).json({
      success: true,
      message: 'Supplier created successfully',
      data: {
        supplier_id: result.insertId,
      },
    })
  } catch (error) {
    console.error('Unable to create supplier:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to create supplier',
    })
  }
}
