import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

export { sql }

export type Executor = {
  execute: (query: unknown) => Promise<{ rows?: unknown[] }>
  transaction?: <T>(work: (transaction: Executor) => Promise<T>) => Promise<T>
}

/** Raw SQL access for the search tables. They are derived data, not Payload collections. */
export const searchDatabase = (payload: Payload): Executor =>
  (payload.db as unknown as { drizzle: Executor }).drizzle

export const rowsOf = async <T>(payload: Payload, query: unknown): Promise<T[]> =>
  ((await searchDatabase(payload).execute(query)).rows ?? []) as T[]

export const rowsFrom = async <T>(executor: Executor, query: unknown): Promise<T[]> =>
  ((await executor.execute(query)).rows ?? []) as T[]

/**
 * Runs `work` on one connection with the typo-matching threshold lowered for just that
 * transaction. The default (0.6) misses common slips such as "neklace".
 */
export const withTypoTolerance = async <T>(
  payload: Payload,
  work: (executor: Executor) => Promise<T>,
): Promise<T> => {
  const database = searchDatabase(payload)
  if (!database.transaction) return work(database)
  return database.transaction(async (transaction) => {
    await transaction.execute(
      sql`SELECT set_config('pg_trgm.word_similarity_threshold', '0.5', true)`,
    )
    return work(transaction)
  })
}
