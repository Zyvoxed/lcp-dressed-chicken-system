import { createHash } from 'node:crypto'

export class IdempotencyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function getIdempotencyKey(request) {
  const key = request.get('Idempotency-Key')?.trim()
  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new IdempotencyError(400, 'A valid Idempotency-Key header is required')
  }
  return key
}

export function hashRequestPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest()
}

export async function reserveIdempotencyKey(connection, { userId, operation, key, payloadHash }) {
  await connection.execute(
    `INSERT INTO idempotency_records
       (user_id, operation_type, idempotency_key, request_hash)
     VALUES (?, ?, ?, ?)`,
    [userId, operation, key, payloadHash],
  )
}

export async function saveIdempotentResponse(connection, {
  userId,
  operation,
  key,
  status,
  body,
}) {
  const [result] = await connection.execute(
    `UPDATE idempotency_records
     SET response_status = ?, response_body = ?
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?`,
    [status, JSON.stringify(body), userId, operation, key],
  )

  if (result.affectedRows !== 1) {
    throw new Error('Unable to persist the idempotent transaction result')
  }
}

export async function findIdempotentResponse(executor, { userId, operation, key }) {
  const [records] = await executor.execute(
    `SELECT request_hash, response_status, response_body
     FROM idempotency_records
     WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?
     LIMIT 1`,
    [userId, operation, key],
  )
  return records[0] || null
}

export function readIdempotentResponse(record, payloadHash) {
  if (!record) return { kind: 'missing' }
  if (!Buffer.from(record.request_hash).equals(payloadHash)) return { kind: 'payload-mismatch' }
  if (!record.response_status || !record.response_body) {
    throw new Error('The idempotent transaction result is incomplete')
  }

  return {
    kind: 'replay',
    status: Number(record.response_status),
    body: typeof record.response_body === 'string'
      ? JSON.parse(record.response_body)
      : record.response_body,
  }
}
