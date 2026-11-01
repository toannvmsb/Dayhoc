import type { Pool } from 'pg';
import type { UploadStorageAdapter } from '@copilot/uploads';

/**
 * Raw-photo retention. The consent centre tells parents that an uploaded photo is kept for at
 * most 30 days; this sweep is what makes that sentence true. Only the stored BYTES go — the
 * `uploads` ledger row, the extraction and any evidence the parent confirmed stay.
 */
export const UPLOAD_RETENTION_DAYS_DEFAULT = 30;
const BATCH = 200;

export function uploadRetentionDays(env: Record<string, string | undefined>): number {
  const n = Number.parseInt(env.UPLOAD_RETENTION_DAYS ?? '', 10);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : UPLOAD_RETENTION_DAYS_DEFAULT;
}

export interface UploadPurgeResult {
  readonly removed: number;
  readonly failed: number;
}

export async function purgeExpiredUploadBytes(
  pool: Pool,
  storage: UploadStorageAdapter,
  now: Date,
  days: number,
): Promise<UploadPurgeResult> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const { rows } = await pool.query<{ analysis_id: string; storage_key: string }>(
    `SELECT a.id AS analysis_id, u.storage_key
       FROM uploads u JOIN upload_analysis a ON a.upload_id = u.id
      WHERE u.created_at < $1 AND a.bytes_purged_at IS NULL
      ORDER BY u.created_at LIMIT $2`,
    [cutoff, BATCH],
  );
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await storage.remove(row.storage_key);
      // marked only after the object is really gone, so a storage outage is retried tomorrow
      await pool.query(`UPDATE upload_analysis SET bytes_purged_at = $2 WHERE id = $1`, [row.analysis_id, now]);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}
