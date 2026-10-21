import pool from '../config/database.js'

const manilaCurrentDate = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let connection

try {
  connection = await pool.getConnection()
  await connection.beginTransaction()

  const [users] = await connection.execute('SELECT user_id FROM users ORDER BY user_id LIMIT 1')
  assert(users.length === 1, 'A user fixture is required for the dashboard trend test')
  const userId = users[0].user_id

  const fixtures = [
    { amount: '1500.00', timestamp: `${manilaCurrentDate} + INTERVAL 5 MINUTE` },
    { amount: '3500.00', timestamp: `${manilaCurrentDate} + INTERVAL 45 MINUTE` },
    { amount: '1250.00', timestamp: `${manilaCurrentDate} + INTERVAL 23 HOUR + INTERVAL 55 MINUTE` },
    { amount: '999.00', timestamp: `${manilaCurrentDate} - INTERVAL 1 MINUTE` },
  ]
  const saleIds = []

  for (const fixture of fixtures) {
    const [result] = await connection.execute(
      `INSERT INTO sales (
         customer_id, user_id, payment_type, total_amount,
         amount_paid, remaining_balance, status, sale_date
       ) VALUES (NULL, ?, 'Cash', ?, ?, 0, 'Paid', ${fixture.timestamp})`,
      [userId, fixture.amount, fixture.amount],
    )
    saleIds.push(result.insertId)
  }

  const [rows] = await connection.execute(`
    SELECT HOUR(sale_date) AS bucket_index, SUM(total_amount) AS sales, COUNT(*) AS transactions
    FROM sales
    WHERE sale_id IN (?, ?, ?, ?)
      AND sale_date >= ${manilaCurrentDate}
      AND sale_date < ${manilaCurrentDate} + INTERVAL 1 DAY
    GROUP BY HOUR(sale_date)
    ORDER BY bucket_index
  `, saleIds)

  const fixtureRows = rows
  assert(fixtureRows.length === 2, 'Today query did not isolate the Manila business date')
  assert(Number(fixtureRows[0].bucket_index) === 0, 'Near-midnight sales were assigned to the wrong hour')
  assert(Number(fixtureRows[0].sales) === 5000, 'Sales within the same hour were not aggregated')
  assert(Number(fixtureRows[0].transactions) === 2, 'Same-hour transaction count was incorrect')
  assert(Number(fixtureRows[1].bucket_index) === 23, 'End-of-day sale was assigned to the wrong hour')

  const series = Array.from({ length: 24 }, (_, index) => {
    const row = fixtureRows.find((item) => Number(item.bucket_index) === index)
    return { sales: row ? Number(row.sales) : 0, transactions: row ? Number(row.transactions) : 0 }
  })
  assert(series[0].sales === 5000 && series[1].sales === 0 && series[23].sales === 1250, 'Zero-hour filling changed recorded values')

  console.log('PASS Manila business-date boundaries and near-midnight sales')
  console.log('PASS same-hour aggregation, values above PHP 1,000, and zero-hour filling')
} finally {
  if (connection) {
    await connection.rollback()
    connection.release()
  }
  await pool.end()
}
