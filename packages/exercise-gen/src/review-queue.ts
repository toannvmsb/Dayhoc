/**
 * Minimal human-review queue (doc 65 §8). MVP scope: an append-then-update
 * store of items a human must look at — a crosscheck `UNCERTAIN`, a no-kernel
 * generation failure, both models failing a slot, or a non-recoverable
 * content-quality failure. NO reviewer portal here; just the queue + a port so
 * an existing admin UI can drive it.
 *
 * Rows carry PSEUDONYMOUS ids only — no child name / school / evidence. The
 * `prompt` snapshot is kept for the reviewer to judge the item; it is
 * short-retention QA data, not operational telemetry.
 */

export const REVIEW_QUEUE_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'REGENERATE_REQUESTED'] as const;
export type ReviewQueueState = (typeof REVIEW_QUEUE_STATES)[number];

export const REVIEW_REASONS = [
  'CROSSCHECK_UNCERTAIN',
  'NO_KERNEL_GENERATION_FAILED',
  'BOTH_MODELS_FAILED',
  'CONTENT_QUALITY_NONRECOVERABLE',
  'SAFETY_ANOMALY',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export interface ReviewQueueItem {
  readonly id: string;
  readonly generationSpecId: string;
  readonly itemId: string; // pseudonymous slot id
  readonly childRef: string | null; // pseudonymous
  readonly reason: ReviewReason;
  readonly state: ReviewQueueState;
  /** QA snapshot — short retention, not telemetry. */
  readonly promptSnapshot: string | null;
  readonly workedSolutionSnapshot: string | null;
  readonly detail: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null; // pseudonymous reviewer id
}

export interface CreateReviewItemInput {
  readonly generationSpecId: string;
  readonly itemId: string;
  readonly childRef?: string | null;
  readonly reason: ReviewReason;
  readonly promptSnapshot?: string | null;
  readonly workedSolutionSnapshot?: string | null;
  readonly detail: string;
}

export interface ReviewQueueStore {
  create(input: CreateReviewItemInput): Promise<ReviewQueueItem>;
  get(id: string): Promise<ReviewQueueItem | null>;
  listPending(): Promise<readonly ReviewQueueItem[]>;
  resolve(id: string, state: Exclude<ReviewQueueState, 'PENDING'>, resolvedBy: string): Promise<ReviewQueueItem>;
}

export function createInMemoryReviewQueue(now: () => Date = () => new Date(), newId: () => string = () => `rq_${Math.random().toString(36).slice(2, 10)}`): ReviewQueueStore {
  const rows = new Map<string, ReviewQueueItem>();
  return {
    create(input) {
      const item: ReviewQueueItem = {
        id: newId(),
        generationSpecId: input.generationSpecId,
        itemId: input.itemId,
        childRef: input.childRef ?? null,
        reason: input.reason,
        state: 'PENDING',
        promptSnapshot: input.promptSnapshot ?? null,
        workedSolutionSnapshot: input.workedSolutionSnapshot ?? null,
        detail: input.detail,
        createdAt: now().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
      };
      rows.set(item.id, item);
      return Promise.resolve(item);
    },
    get: (id) => Promise.resolve(rows.get(id) ?? null),
    listPending: () => Promise.resolve([...rows.values()].filter((r) => r.state === 'PENDING')),
    resolve(id, state, resolvedBy) {
      const cur = rows.get(id);
      if (!cur) return Promise.reject(new Error(`unknown review item ${id}`));
      if (cur.state !== 'PENDING') return Promise.reject(new Error(`review item ${id} already ${cur.state}`));
      const updated: ReviewQueueItem = { ...cur, state, resolvedAt: now().toISOString(), resolvedBy };
      rows.set(id, updated);
      return Promise.resolve(updated);
    },
  };
}
