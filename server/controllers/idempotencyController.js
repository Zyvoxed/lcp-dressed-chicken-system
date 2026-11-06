import pool from '../config/database.js'

const operations = new Set(['sale', 'stock_in', 'payment'])

export async function getIdempotencyStatus(request, response) {
  const { operation, key } = request.params
  if (!operations.has(operation) || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    return response.status(400).json({ success: false, message: 'Invalid transaction recovery request' })
  }

  try {
    const [records] = await pool.execute(
      `SELECT response_status, response_body
       FROM idempotency_records
       WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?
       LIMIT 1`,
      [request.user.user_id, operation, key],
    )
    const record = records[0]
    if (!record) {
      return response.json({ success: true, data: { state: 'not_found' } })
    }
    if (!record.response_status || !record.response_body) {
      throw new Error('The saved transaction result is incomplete')
    }

    return response.json({
      success: true,
      data: {
        state: 'completed',
        status: Number(record.response_status),
        response: typeof record.response_body === 'string'
          ? JSON.parse(record.response_body)
          : record.response_body,
      },
    })
  } catch (error) {
    console.error('Unable to retrieve transaction recovery status:', error.message)
    return response.status(500).json({ success: false, message: 'Unable to check the saved transaction status' })
  }
}
