import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { GeneratedExercise } from '@copilot/domain';
import type { WorksheetResult } from '@copilot/exercise-gen';
import { captureQaSamples, qaSampleRate } from './internal-live-observability.js';

/**
 * doc 69 §8 / doc 70 §9 — decide whether to keep a short-retention QA sample of
 * a delivered worksheet. Event-triggered on any degraded path (safe substitution
 * / optional omission / crosscheck-uncertain / review-required / high retry) so a
 * reviewer always sees the risky ones; otherwise at the configured base rate
 * (1-in-N for internal LIVE, `PILOT_QA_SAMPLE_RATE` for pilot families).
 */
export function shouldSampleQa(
  result: WorksheetResult,
  runId: string,
  env: Record<string, string | undefined> = process.env,
): { sample: boolean; reason: string } {
  const perSlot = result.trace.perSlot;
  if (result.substitutedSlots > 0) return { sample: true, reason: 'safe_substitution' };
  if (result.omittedSlots > 0) return { sample: true, reason: 'optional_omission' };
  if (perSlot.some((s) => s.crosscheckVerdict === 'UNCERTAIN')) return { sample: true, reason: 'crosscheck_uncertain' };
  if (perSlot.some((s) => s.reviewQueueId)) return { sample: true, reason: 'review_required' };
  if (perSlot.some((s) => s.attempts.length >= 3)) return { sample: true, reason: 'high_retry' };
  const pilotRate = Number.parseFloat(env.PILOT_QA_SAMPLE_RATE ?? '');
  if (Number.isFinite(pilotRate) && pilotRate >= 0 && pilotRate <= 1) {
    return hashInt(runId) % 1000 < pilotRate * 1000
      ? { sample: true, reason: 'pilot_base_rate' }
      : { sample: false, reason: 'not_sampled' };
  }
  const oneIn = qaSampleRate(env);
  return oneIn > 0 && hashInt(runId) % oneIn === 0
    ? { sample: true, reason: 'internal_one_in_n' }
    : { sample: false, reason: 'not_sampled' };
}

/**
 * CONTROLLED INTERNAL LIVE — turn a completed LIVE worksheet run into a
 * child-visible `AI_GENERATED` assignment (doc 69 §5/§6).
 *
 * SAFETY (never relaxed): only slots that are `READY` AND verified
 * (deterministically correct OR crosscheck-PASS) are ever delivered. A pending /
 * omitted / unverified item is dropped here even though the orchestrator should
 * already have excluded it — defence in depth.
 *
 * The run is persisted pseudonymously (no childId in `worksheet_generation_runs`
 * or `worksheet_jobs`). The READY item content is held in `worksheet_run_serving`
 * — keyed by the pseudonymous `child_ref` — ONLY until the next authenticated
 * request from that child turns it into a real assignment (then the content is
 * nulled). Purged on child deletion and on a 48h TTL.
 */

const K_LEVELS = ['K0', 'K1', 'K2', 'K3', 'K4', 'K5'];
const T_LEVELS = ['T1', 'T2', 'T3', 'T4', 'T5'];
export const childRefOf = (childId: string): string => createHash('sha256').update(childId).digest('hex').slice(0, 16);

export interface ServableItem {
  readonly orderIndex: number;
  readonly questionRef: string;
  readonly skillId: string;
  readonly problemTypeId: string | null;
  readonly knowledgeLevel: number | null;
  readonly thinkingLevel: number | null;
  readonly prompt: { text: string };
  readonly answerSpec: unknown;
  readonly hints: readonly unknown[];
}

/** verified READY items only, in worksheet order (doc 69 §5 safety). */
export function servableItemsOf(result: WorksheetResult): ServableItem[] {
  const verifiedIds = new Set(
    result.trace.perSlot
      .filter((s) => s.finalState === 'READY' && (s.answerStatus === 'DETERMINISTIC_CORRECT' || s.crosscheckVerdict === 'PASS'))
      .map((s) => s.itemId),
  );
  // `result.items` are the accepted GeneratedExercise objects; a slot's itemId is
  // `${generationSpecId}::item-NN`. We keep only exercises whose owning slot is
  // verified-READY. The exercise's own id is a ULID, so match on order/skill via
  // the perSlot list.
  const perSlot = result.trace.perSlot.filter((s) => verifiedIds.has(s.itemId));
  const items = [...result.items];
  return perSlot
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((_s, i): ServableItem | null => {
      const ex: GeneratedExercise | undefined = items[i];
      if (!ex) return null;
      return {
        orderIndex: i,
        questionRef: ex.id,
        skillId: String(ex.skillId),
        problemTypeId: ex.problemTypeId ? String(ex.problemTypeId) : null,
        knowledgeLevel: K_LEVELS.indexOf(ex.knowledgeLevel) >= 0 ? K_LEVELS.indexOf(ex.knowledgeLevel) : null,
        thinkingLevel: T_LEVELS.indexOf(ex.thinkingLevel) >= 0 ? T_LEVELS.indexOf(ex.thinkingLevel) : null,
        prompt: { text: ex.prompt },
        answerSpec: ex.answerSpec,
        hints: [...ex.hints],
      };
    })
    .filter((x): x is ServableItem => x !== null);
}

export interface RecordServingIntentInput {
  readonly runId: string;
  /** pseudonymous — the job carries this, never the raw childId. */
  readonly childRef: string;
  readonly generationSpecId: string;
  readonly result: WorksheetResult;
  readonly env?: Record<string, string | undefined>;
}

/**
 * Called from the LIVE generation callback (queue `onOutcome` / durable worker).
 * Persists the verified items into `worksheet_run_serving` PENDING, and (1-in-N)
 * a short-retention QA sample. Never throws.
 */
export async function recordServingIntent(pool: Pool, input: RecordServingIntentInput): Promise<void> {
  try {
    const items = servableItemsOf(input.result);
    const childRef = input.childRef;
    if (items.length === 0) {
      await pool.query(
        `INSERT INTO worksheet_run_serving (run_id, child_ref, generation_spec_id, state, skip_reason)
         VALUES ($1,$2,$3,'SKIPPED','no verified READY item') ON CONFLICT (run_id) DO NOTHING`,
        [input.runId, childRef, input.generationSpecId],
      );
      return;
    }
    await pool.query(
      `INSERT INTO worksheet_run_serving (run_id, child_ref, generation_spec_id, items, state)
       VALUES ($1,$2,$3,$4::jsonb,'PENDING') ON CONFLICT (run_id) DO NOTHING`,
      [input.runId, childRef, input.generationSpecId, JSON.stringify(items)],
    );

    // QA sample of the delivered worksheet (doc 69 §8 / doc 70 §9) —
    // event-triggered on degraded paths, else at the configured base rate.
    const qa = shouldSampleQa(input.result, input.runId, input.env);
    if (qa.sample) {
      const samples = input.result.trace.perSlot
        .filter((s) => s.finalState === 'READY')
        .slice(0, 3)
        .map((s, i) => ({
          runId: input.runId,
          generationSpecId: input.generationSpecId,
          childRef,
          itemId: s.itemId,
          criticality: s.criticality,
          finalState: s.finalState,
          promptSnapshot: items[i]?.prompt.text ?? null,
          workedSolutionSnapshot: input.result.items[i]?.workedSolution ?? null,
          answerSnapshot: JSON.stringify(input.result.items[i]?.answerSpec ?? null),
        }));
      await captureQaSamples(pool, samples, input.env);
    }
  } catch {
    // serving intent is best-effort — a failure here only means the child does
    // not get an AI worksheet this cycle (the legacy path still answers Today).
  }
}

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface PendingServe {
  readonly runId: string;
  readonly generationSpecId: string;
  readonly items: readonly ServableItem[];
}

/** The oldest PENDING LIVE worksheet for this authenticated child, if any. */
export async function pendingLiveWorksheetFor(pool: Pool, childId: string): Promise<PendingServe | null> {
  const childRef = childRefOf(childId);
  const { rows } = await pool.query<{ run_id: string; generation_spec_id: string; items: ServableItem[] | null }>(
    `SELECT run_id, generation_spec_id, items FROM worksheet_run_serving
      WHERE child_ref = $1 AND state = 'PENDING' AND items IS NOT NULL
      ORDER BY created_at LIMIT 1`,
    [childRef],
  );
  const r = rows[0];
  if (!r || !r.items || r.items.length === 0) return null;
  return { runId: r.run_id, generationSpecId: r.generation_spec_id, items: r.items };
}

/** Mark a serving row SERVED (or SKIPPED) and drop the held content. */
export async function markServed(
  pool: Pool,
  runId: string,
  outcome: { assignmentId: string } | { skipReason: string },
): Promise<void> {
  if ('assignmentId' in outcome) {
    await pool.query(
      `UPDATE worksheet_run_serving
          SET state = 'SERVED', assignment_id = $2, items = NULL, served_at = now()
        WHERE run_id = $1 AND state = 'PENDING'`,
      [runId, outcome.assignmentId],
    );
  } else {
    await pool.query(
      `UPDATE worksheet_run_serving
          SET state = 'SKIPPED', skip_reason = $2, items = NULL
        WHERE run_id = $1 AND state = 'PENDING'`,
      [runId, outcome.skipReason],
    );
  }
}

/** TTL sweep — drop content for serving rows never claimed within 48h. */
export async function purgeStaleServingIntents(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE worksheet_run_serving
        SET state = 'SKIPPED', skip_reason = 'ttl — not claimed within 48h', items = NULL
      WHERE state = 'PENDING' AND created_at < now() - interval '48 hours'`,
  );
  return rowCount ?? 0;
}

/** Child-deletion purge (call inside the deletion workflow). */
export async function purgeServingForChild(client: import('pg').PoolClient, childRef: string): Promise<number> {
  const r = await client.query(`DELETE FROM worksheet_run_serving WHERE child_ref = $1`, [childRef]);
  return r.rowCount ?? 0;
}
