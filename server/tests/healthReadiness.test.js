import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import app from '../app.js'
import pool from '../config/database.js'

test('liveness stays available and readiness reports database failure without internal details', async () => {
  const originalQuery = pool.query
  pool.query = async () => { throw new Error('private database connection detail') }
  const server = createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const base = `http://127.0.0.1:${server.address().port}/api`
  try {
    const live = await fetch(`${base}/health`)
    assert.equal(live.status, 200)
    assert.equal((await live.json()).success, true)

    const ready = await fetch(`${base}/ready`)
    const payload = await ready.json()
    assert.equal(ready.status, 503)
    assert.deepEqual(payload, { success: false, ready: false, message: 'Service temporarily unavailable' })
    assert.equal(JSON.stringify(payload).includes('private database'), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    pool.query = originalQuery
  }
})

test('readiness returns success when the database check succeeds', async () => {
  const originalQuery = pool.query
  pool.query = async (sql) => {
    assert.equal(sql, 'SELECT 1')
    return [[{ 1: 1 }]]
  }
  const server = createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ready`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { success: true, ready: true })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    pool.query = originalQuery
  }
})
