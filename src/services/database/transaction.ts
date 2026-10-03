import type { PayloadRequest } from 'payload'

type TransactionDatabase = { execute: (query: unknown) => Promise<{ rows?: unknown[] }> }

export const transactionDatabase = async (req: PayloadRequest): Promise<TransactionDatabase> => {
  const transactionID = await req.transactionID
  if (!transactionID) throw new Error('A database transaction is required for this operation.')
  const session = req.payload.db.sessions?.[String(transactionID)]
  if (!session?.db) throw new Error('The active PostgreSQL transaction session is unavailable.')
  return session.db as TransactionDatabase
}

export const withTransaction = async <T>(
  req: PayloadRequest,
  operation: () => Promise<T>,
): Promise<T> => {
  if (await req.transactionID) return operation()
  const transactionID = await req.payload.db.beginTransaction()
  if (!transactionID)
    throw new Error('PostgreSQL transactions are required for commerce operations.')
  req.transactionID = transactionID
  try {
    const result = await operation()
    await req.payload.db.commitTransaction(transactionID)
    delete req.transactionID
    return result
  } catch (error) {
    await req.payload.db.rollbackTransaction(transactionID)
    delete req.transactionID
    throw error
  }
}
