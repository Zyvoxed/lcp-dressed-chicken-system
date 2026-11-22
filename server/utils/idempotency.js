import { createHash } from 'node:crypto'

export class IdempotencyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export class IdempotencyKeyConflictError extends IdempotencyError {
  constructor(cause) {
    super(409, 'Idempotency key already exists')
    this.name = 'IdempotencyKeyConflictError'
    this.code = 'IDEMPOTENCY_KEY_CONFLICT'
    this.cause = cause
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
  // Callers normalize quantities and cents first so equivalent requests hash identically.
  return createHash('sha256').update(JSON.stringify(payload)).digest()
}

function isIdempotencyReservationConflict(error) {
  const databaseMessage = `${error.sqlMessage || ''} ${error.message || ''}`
  return error.code === 'ER_DUP_ENTRY'
    && /\buq_idempotency_user_operation_key\b/i.test(databaseMessage)
}

export async function reserveIdempotencyKey(connection, { userId, operation, key, payloadHash }) {
  try {
    await connection.execute(
      `INSERT INTO idempotency_records
         (user_id, operation_type, idempotency_key, request_hash)
       VALUES (?, ?, ?, ?)`,
      [userId, operation, key, payloadHash],
    )
  } catch (error) {
    // Only the named request-scope index proves this is a retry collision; another
    // unique-key error may belong to business data and must not be replayed.
    if (isIdempotencyReservationConflict(error)) {
      throw new IdempotencyKeyConflictError(error)
    }
    throw error
  }
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

export async function resolveIdempotencyReplay(executor, idempotency) {
  const record = await findIdempotentResponse(executor, idempotency)
  if (!record) return { kind: 'unverified' }

  try {
    return readIdempotentResponse(record, idempotency.payloadHash)
  } catch {
    return { kind: 'unverified' }
  }
}

export function readIdempotentResponse(record, payloadHash) {
  if (!record) return { kind: 'missing' }
  // A reservation without a response may be in flight or uncertain, not completed.
  if (!record.response_status || !record.response_body) {
    throw new Error('The idempotent transaction result is incomplete')
  }
  // Reusing a key with different normalized input must never return another request's result.
  if (!Buffer.from(record.request_hash).equals(payloadHash)) return { kind: 'payload-mismatch' }

  return {
    kind: 'replay',
    status: Number(record.response_status),
    body: typeof record.response_body === 'string'
      ? JSON.parse(record.response_body)
      : record.response_body,
  }
}
