import type { Pool, PoolClient } from 'pg';

/**
 * Run `fn` inside a single Postgres transaction (§14). Used for operations that
 * touch multiple authorization objects — relationship accept/revoke, permission
 * update, privacy update, enrollment transition — so an authorization decision
 * never leaves partially-applied state.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure — surface the original error */
    }
    throw err;
  } finally {
    client.release();
  }
}
