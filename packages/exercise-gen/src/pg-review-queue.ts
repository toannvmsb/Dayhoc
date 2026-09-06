import type { Pool } from 'pg';
import type {
  CreateReviewItemInput,
  ReviewQueueItem,
  ReviewQueueState,
  ReviewQueueStore,
} from './review-queue.js';

/**
 * PostgreSQL backend for `review_queue` (doc 65 §8; migration
 * `1758499200000_worksheet_generation.js`). The ONE mutable table in that
 * migration — a reviewer resolves a row exactly once (`state = 'PENDING'` guard
 * on the UPDATE).
 *
 * The prompt / worked-solution snapshots are SHORT-RETENTION QA data; the
 * retention job purges them on the standard schedule. `child_ref` is
 * pseudonymous.
 */
export class PgReviewQueueStore implements ReviewQueueStore {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => `rq_${Math.random().toString(36).slice(2, 12)}`,
  ) {}

  async create(input: CreateReviewItemInput): Promise<ReviewQueueItem> {
    const id = this.newId();
    const createdAt = this.now().toISOString();
    await this.pool.query(
      `INSERT INTO review_queue
         (id, generation_spec_id, item_id, child_ref, reason, state, prompt_snapshot,
          worked_solution_snapshot, detail, created_at)
       VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9)`,
      [
        id, input.generationSpecId, input.itemId, input.childRef ?? null, input.reason,
        input.promptSnapshot ?? null, input.workedSolutionSnapshot ?? null, input.detail, createdAt,
      ],
    );
    return {
      id,
      generationSpecId: input.generationSpecId,
      itemId: input.itemId,
      childRef: input.childRef ?? null,
      reason: input.reason,
      state: 'PENDING',
      promptSnapshot: input.promptSnapshot ?? null,
      workedSolutionSnapshot: input.workedSolutionSnapshot ?? null,
      detail: input.detail,
      createdAt,
      resolvedAt: null,
      resolvedBy: null,
    };
  }

  async get(id: string): Promise<ReviewQueueItem | null> {
    const { rows } = await this.pool.query(`SELECT * FROM review_queue WHERE id = $1`, [id]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  async listPending(): Promise<readonly ReviewQueueItem[]> {
    const { rows } = await this.pool.query(`SELECT * FROM review_queue WHERE state = 'PENDING' ORDER BY created_at`);
    return rows.map(toItem);
  }

  async resolve(id: string, state: Exclude<ReviewQueueState, 'PENDING'>, resolvedBy: string): Promise<ReviewQueueItem> {
    const { rows } = await this.pool.query(
      `UPDATE review_queue
          SET state = $2, resolved_at = now(), resolved_by = $3
        WHERE id = $1 AND state = 'PENDING'
      RETURNING *`,
      [id, state, resolvedBy],
    );
    if (!rows[0]) {
      const cur = await this.get(id);
      throw new Error(cur ? `review item ${id} already ${cur.state}` : `unknown review item ${id}`);
    }
    return toItem(rows[0]);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toItem(x: any): ReviewQueueItem {
  return {
    id: x.id,
    generationSpecId: x.generation_spec_id,
    itemId: x.item_id,
    childRef: x.child_ref,
    reason: x.reason,
    state: x.state,
    promptSnapshot: x.prompt_snapshot,
    workedSolutionSnapshot: x.worked_solution_snapshot,
    detail: x.detail,
    createdAt: new Date(x.created_at).toISOString(),
    resolvedAt: x.resolved_at ? new Date(x.resolved_at).toISOString() : null,
    resolvedBy: x.resolved_by,
  };
}
