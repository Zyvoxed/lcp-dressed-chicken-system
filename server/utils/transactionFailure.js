function discardConnection(connection, operation, error, rollbackError = null) {
  try {
    connection?.destroy()
  } catch (disposeError) {
    console.error(`Unable to discard ${operation} database connection`, {
      errorCode: error?.code || 'UNKNOWN',
      rollbackErrorCode: rollbackError?.code || null,
      disposeErrorCode: disposeError?.code || 'UNKNOWN',
    })
  }
}

export async function resolveTransactionFailure({
  connection,
  transactionBeginAttempted = false,
  transactionStarted,
  commitAttempted,
  commitCompleted = false,
  error,
  operation,
  rejectionConfirmed,
}) {
  if (transactionBeginAttempted && !transactionStarted) {
    console.error(`Unable to start ${operation} transaction`, {
      errorCode: error?.code || 'UNKNOWN',
    })
    discardConnection(connection, operation, error)
    return { outcome: 'unknown', reusable: false }
  }

  if (commitAttempted && !commitCompleted) {
    console.error(`Unable to confirm ${operation} transaction commit`, {
      errorCode: error?.code || 'UNKNOWN',
    })
    discardConnection(connection, operation, error)
    return { outcome: 'unknown', reusable: false }
  }

  if (commitCompleted) {
    return { outcome: 'unknown', reusable: true }
  }

  let rollbackCompleted = !transactionStarted
  let rollbackError = null
  if (connection && transactionStarted) {
    try {
      await connection.rollback()
      rollbackCompleted = true
    } catch (failure) {
      rollbackError = failure
    }
  }

  if (rollbackError) {
    console.error(`Unable to roll back ${operation} transaction`, {
      errorCode: error?.code || 'UNKNOWN',
      rollbackErrorCode: rollbackError.code || 'UNKNOWN',
    })
    discardConnection(connection, operation, error, rollbackError)
    return { outcome: 'unknown', reusable: false }
  }

  return {
    outcome: rejectionConfirmed && rollbackCompleted ? 'not_committed' : 'unknown',
    reusable: true,
  }
}
