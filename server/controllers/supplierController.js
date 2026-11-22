import pool from '../config/database.js'

class SupplierError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function parseSupplierId(value) {
  if (!/^\d+$/.test(String(value ?? ''))) throw new SupplierError(400, 'Invalid supplier ID')
  const supplierId = Number(value)
  if (!Number.isSafeInteger(supplierId) || supplierId <= 0 || supplierId > 2147483647) {
    throw new SupplierError(400, 'Invalid supplier ID')
  }
  return supplierId
}

function supplierDetails(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SupplierError(400, 'Supplier details are required')
  }

  const supplierName = typeof body.supplier_name === 'string' ? body.supplier_name.trim() : ''
  const contactNumber = typeof body.contact_number === 'string' ? body.contact_number.trim() : ''
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const contactPersonProvided = body.contact_person !== undefined && body.contact_person !== null
  if (contactPersonProvided && typeof body.contact_person !== 'string') {
    throw new SupplierError(400, 'Contact person must be text')
  }
  const contactPerson = contactPersonProvided ? body.contact_person.trim() || null : null

  if (!supplierName) throw new SupplierError(400, 'Supplier name is required')
  if (supplierName.length > 100) throw new SupplierError(400, 'Supplier name must be 100 characters or fewer')
  if (contactPerson && contactPerson.length > 100) {
    throw new SupplierError(400, 'Contact person must be 100 characters or fewer')
  }
  if (!contactNumber) throw new SupplierError(400, 'Contact number is required')
  if (contactNumber.length > 20) throw new SupplierError(400, 'Contact number must be 20 characters or fewer')
  if (typeof body.address !== 'string' || !address) throw new SupplierError(400, 'Address is required')

  return { supplierName, contactPerson, contactNumber, address }
}

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

export async function getArchivedSuppliers(request, response) {
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
      WHERE is_active = FALSE
      ORDER BY supplier_name ASC
    `)

    return response.json({ success: true, data: suppliers })
  } catch (error) {
    console.error('Unable to retrieve archived suppliers:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to retrieve archived suppliers' })
  }
}

async function changeSupplierStatus(request, response, restore) {
  let connection
  let transactionStarted = false

  try {
    const supplierId = Number(request.params.id)
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      throw new SupplierError(400, 'Invalid supplier ID')
    }

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const [suppliers] = await connection.execute(
      `SELECT supplier_id, supplier_name, is_active
       FROM suppliers
       WHERE supplier_id = ?
       LIMIT 1
       FOR UPDATE`,
      [supplierId],
    )
    const supplier = suppliers[0]
    if (!supplier) throw new SupplierError(404, 'Supplier not found')
    if (restore && supplier.is_active) throw new SupplierError(409, 'Supplier is already active')
    if (!restore && !supplier.is_active) throw new SupplierError(409, 'Supplier is already archived')

    await connection.execute(
      `UPDATE suppliers SET is_active = ${restore ? 'TRUE' : 'FALSE'} WHERE supplier_id = ?`,
      [supplierId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [
        request.user.user_id,
        restore ? 'SUPPLIER_RESTORED' : 'SUPPLIER_ARCHIVED',
        `Supplier ${supplierId} (${supplier.supplier_name}) ${restore ? 'restored' : 'archived'}`,
      ],
    )

    await connection.commit()
    transactionStarted = false
    return response.json({
      success: true,
      message: restore ? 'Supplier restored successfully' : 'Supplier archived successfully',
      data: { supplier_id: supplierId, supplier_name: supplier.supplier_name, is_active: restore },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    if (error instanceof SupplierError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error(`Unable to ${restore ? 'restore' : 'archive'} supplier:`, error.message)
    return response.status(500).json({ success: false, message: `Unable to ${restore ? 'restore' : 'archive'} supplier` })
  } finally {
    connection?.release()
  }
}

export function archiveSupplier(request, response) {
  return changeSupplierStatus(request, response, false)
}

export function restoreSupplier(request, response) {
  return changeSupplierStatus(request, response, true)
}

export async function createSupplier(request, response) {
  try {
    const { supplierName, contactPerson, contactNumber, address } = supplierDetails(request.body)
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
    if (error instanceof SupplierError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to create supplier:', error.message)
    return response.status(500).json({
      success: false,
      message: 'Unable to create supplier',
    })
  }
}

export async function updateSupplier(request, response) {
  let connection
  let transactionStarted = false

  try {
    const supplierId = parseSupplierId(request.params.id)
    const { supplierName, contactPerson, contactNumber, address } = supplierDetails(request.body)

    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionStarted = true

    const [suppliers] = await connection.execute(
      `SELECT supplier_id, supplier_name, is_active
       FROM suppliers
       WHERE supplier_id = ?
       LIMIT 1
       FOR UPDATE`,
      [supplierId],
    )
    if (!suppliers[0]) throw new SupplierError(404, 'Supplier not found')

    await connection.execute(
      `UPDATE suppliers
       SET supplier_name = ?, contact_person = ?, contact_number = ?, address = ?
       WHERE supplier_id = ?`,
      [supplierName, contactPerson, contactNumber, address, supplierId],
    )
    await connection.execute(
      `INSERT INTO activity_logs (user_id, action, description, created_at)
       VALUES (?, 'SUPPLIER_UPDATED', ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`,
      [request.user.user_id, `Supplier ${supplierId} (${supplierName}) details updated`],
    )

    await connection.commit()
    transactionStarted = false
    return response.json({
      success: true,
      message: 'Supplier updated successfully',
      data: {
        supplier_id: supplierId,
        supplier_name: supplierName,
        contact_person: contactPerson,
        contact_number: contactNumber,
        address,
        is_active: suppliers[0].is_active,
      },
    })
  } catch (error) {
    if (transactionStarted) await connection.rollback()
    if (error instanceof SupplierError) {
      return response.status(error.status).json({ success: false, message: error.message })
    }
    console.error('Unable to update supplier:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to update supplier' })
  } finally {
    connection?.release()
  }
}
