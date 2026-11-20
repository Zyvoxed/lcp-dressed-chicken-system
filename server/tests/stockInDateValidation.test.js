import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import jwt from 'jsonwebtoken'
import pool from '../config/database.js'
import { createStockIn } from '../controllers/stockInController.js'
import stockInRoutes from '../routes/stockInRoutes.js'
import {
  getBusinessCalendarDate,
  getBusinessDateTimeLocal,
  getStockInCalendarDate,
  isStockInDateAllowed,
  STOCK_IN_FUTURE_DATE_MESSAGE,
} from '../../shared/stockInDate.js'

function addCalendarDays(dateText, dayCount) {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + dayCount)).toISOString().slice(0, 10)
}

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
  }
}

test('Stock-In calendar dates use the Manila business date and permit today or history', () => {
  const now = new Date('2026-11-19T02:00:00.000Z')
  assert.equal(getBusinessCalendarDate(now), '2026-11-19')
  assert.equal(getBusinessDateTimeLocal(now), '2026-11-19T10:00')

  for (const date of [
    '2026-11-18T23:59',
    '2026-10-31T12:00',
    '2025-12-31T12:00',
    '2026-11-19',
    '2026-11-19T23:59',
    '2026-11-19T15:59:00Z',
  ]) {
    assert.equal(isStockInDateAllowed(date, now), true, date)
  }
})

test('future and malformed Stock-In calendar dates are rejected in Manila time', () => {
  const now = new Date('2026-11-19T02:00:00.000Z')
  for (const date of [
    '2026-11-20T00:00',
    '2026-11-21T10:00',
    '2026-11-30T10:00',
    '2027-01-01T10:00',
    '2026-11-19T16:00:00Z',
    '2026-02-30T10:00',
    'not-a-date',
    '',
  ]) {
    assert.equal(isStockInDateAllowed(date, now), false, date)
    if (date) assert.equal(getStockInCalendarDate(date) === null, date.includes('02-30') || date === 'not-a-date')
  }
})

test('direct Stock-In controller requests reject future dates before database access', async () => {
  const originalGetConnection = pool.getConnection
  let databaseCalls = 0
  pool.getConnection = async () => {
    databaseCalls += 1
    throw new Error('Future Stock-In request must not begin a database transaction')
  }

  try {
    const currentDate = getBusinessCalendarDate()
    const [year, month, day] = currentDate.split('-').map(Number)
    const finalDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const futureDates = [
      `${addCalendarDays(currentDate, 1)}T10:00`,
      `${addCalendarDays(currentDate, 2)}T10:00`,
      ...(day < finalDayOfMonth ? [`${year}-${String(month).padStart(2, '0')}-${finalDayOfMonth}T10:00`] : []),
      `${Number(currentDate.slice(0, 4)) + 1}-01-01T10:00`,
    ]

    for (const deliveryDate of futureDates) {
      const response = responseRecorder()
      await createStockIn({
        body: {
          supplier_id: 1,
          product_id: 1,
          quantity_received: '1.000',
          cost_price: '10.00',
          delivery_date: deliveryDate,
        },
        user: { user_id: 1 },
        get: (name) => name.toLowerCase() === 'idempotency-key' ? `future-stock-in-${deliveryDate}` : undefined,
      }, response)
      assert.equal(response.statusCode, 400, deliveryDate)
      assert.equal(response.payload.success, false)
      assert.equal(response.payload.message, STOCK_IN_FUTURE_DATE_MESSAGE)
      assert.equal(response.payload.transaction_outcome, 'not_committed')
    }

    for (const deliveryDate of ['not-a-date', '2026-02-30T10:00']) {
      const response = responseRecorder()
      await createStockIn({
        body: {
          supplier_id: 1,
          product_id: 1,
          quantity_received: '1.000',
          cost_price: '10.00',
          delivery_date: deliveryDate,
        },
        user: { user_id: 1 },
        get: () => 'malformed-stock-in-date',
      }, response)
      assert.equal(response.statusCode, 400)
      assert.match(response.payload.message, /date is invalid/i)
    }

    assert.equal(databaseCalls, 0)
  } finally {
    pool.getConnection = originalGetConnection
  }
})

test('POST /api/stock-in rejects a future date without opening a transaction or inserting a batch', async () => {
  const originalExecute = pool.execute
  const originalGetConnection = pool.getConnection
  let authenticationQueries = 0
  let transactionConnections = 0
  pool.execute = async () => {
    authenticationQueries += 1
    return [[{ role: 'Admin', is_active: 1, auth_version: 0 }], []]
  }
  pool.getConnection = async () => {
    transactionConnections += 1
    throw new Error('Future request must not acquire a transaction connection')
  }

  const app = express()
  app.use(express.json())
  app.use('/api/stock-in', stockInRoutes)
  const server = app.listen(0, '127.0.0.1')
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const currentDate = getBusinessCalendarDate()
    const token = jwt.sign({
      user_id: 1,
      role: 'Admin',
      auth_version: 0,
      mfa_verified: true,
    }, process.env.JWT_SECRET)
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stock-in`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'future-stock-in-api-test',
      },
      body: JSON.stringify({
        supplier_id: 1,
        product_id: 1,
        quantity_received: '1.000',
        cost_price: '10.00',
        delivery_date: `${addCalendarDays(currentDate, 1)}T10:00`,
      }),
    })
    const body = await response.json()
    assert.equal(response.status, 400)
    assert.equal(body.message, STOCK_IN_FUTURE_DATE_MESSAGE)
    assert.equal(body.transaction_outcome, 'not_committed')
    assert.equal(authenticationQueries, 1)
    assert.equal(transactionConnections, 0)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    pool.execute = originalExecute
    pool.getConnection = originalGetConnection
  }
})
