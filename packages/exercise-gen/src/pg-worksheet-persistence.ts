import type { Pool } from 'pg';
import type {
  WorksheetGenerationStore,
  WorksheetPersistBundle,
  WorksheetRunRecord,
  WorksheetSlotRecord,
  WorksheetSlotAttemptRecord,
} from './worksheet-persistence.js';

/**
 * PostgreSQL backend for the worksheet-orchestrator tables (doc 65 §3;
 * migration `1758499200000_worksheet_generation.js`). INSERT-only — the three
 * tables carry `reject_ledger_mutation` triggers on UPDATE/DELETE.
 *
 * A single `putRun` writes the run + all its slots + all its attempts inside one
 * transaction. NO child PII is ever passed here (see `toWorksheetRecords`).
 */
export class PgWorksheetGenerationStore implements WorksheetGenerationStore {
  constructor(private readonly pool: Pool) {}

  async putRun(bundle: WorksheetPersistBundle): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = bundle.run;
      await client.query(
        `INSERT INTO worksheet_generation_runs
           (id, generation_spec_id, child_ref, mode, worksheet_state, ready_slots,
            pending_crosscheck_slots, failed_slots, orchestrator_version, router_version,
            retry_context_version, last_resort_version, content_quality_version,
            item_validator_version, crosscheck_adapter_name, model_calls, retries,
            fallback_calls, last_resort_calls, input_tokens, output_tokens,
            estimated_cost_usd, actual_cost_usd, cost_ceiling_hit, worksheet_latency_ms,
            cost_event_refs, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [
          r.id, r.generationSpecId, r.childRef, r.mode, r.worksheetState, r.readySlots,
          r.pendingCrosscheckSlots, r.failedSlots, r.orchestratorVersion, r.routerVersion,
          r.retryContextVersion, r.lastResortVersion, r.contentQualityVersion,
          r.itemValidatorVersion, r.crosscheckAdapterName, r.modelCalls, r.retries,
          r.fallbackCalls, r.lastResortCalls, r.inputTokens, r.outputTokens,
          r.estimatedCostUsd, r.actualCostUsd, r.costCeilingHit, r.worksheetLatencyMs,
          r.costEventRefs, r.createdAt,
        ],
      );
      for (const s of bundle.slots) {
        await client.query(
          `INSERT INTO worksheet_slots
             (id, run_id, generation_spec_id, item_id, index, kernel_family, initial_role,
              route_reason, final_state, last_resort_used, crosscheck_required,
              crosscheck_verdict, content_quality_codes, review_queue_id, answer_status,
              production_ready, slot_latency_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            s.id, s.runId, s.generationSpecId, s.itemId, s.index, s.kernelFamily, s.initialRole,
            s.routeReason, s.finalState, s.lastResortUsed, s.crosscheckRequired,
            s.crosscheckVerdict, s.contentQualityCodes, s.reviewQueueId, s.answerStatus,
            s.productionReady, s.slotLatencyMs,
          ],
        );
      }
      for (const a of bundle.attempts) {
        await client.query(
          `INSERT INTO worksheet_slot_attempts
             (id, run_id, item_id, attempt, model, role, step, accepted, failure_category,
              retry_reason, latency_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [a.id, a.runId, a.itemId, a.attempt, a.model, a.role, a.step, a.accepted, a.failureCategory, a.retryReason, a.latencyMs],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async getRun(runId: string): Promise<WorksheetRunRecord | null> {
    const { rows } = await this.pool.query(`SELECT * FROM worksheet_generation_runs WHERE id = $1`, [runId]);
    return rows[0] ? rowToRun(rows[0]) : null;
  }

  async listRuns(generationSpecId: string): Promise<readonly WorksheetRunRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM worksheet_generation_runs WHERE generation_spec_id = $1 ORDER BY created_at`,
      [generationSpecId],
    );
    return rows.map(rowToRun);
  }

  async listSlots(runId: string): Promise<readonly WorksheetSlotRecord[]> {
    const { rows } = await this.pool.query(`SELECT * FROM worksheet_slots WHERE run_id = $1 ORDER BY index`, [runId]);
    return rows.map(rowToSlot);
  }

  async listAttempts(runId: string): Promise<readonly WorksheetSlotAttemptRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM worksheet_slot_attempts WHERE run_id = $1 ORDER BY item_id, attempt`,
      [runId],
    );
    return rows.map(rowToAttempt);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToRun(x: any): WorksheetRunRecord {
  return {
    id: x.id, generationSpecId: x.generation_spec_id, childRef: x.child_ref, mode: x.mode,
    worksheetState: x.worksheet_state, readySlots: x.ready_slots,
    pendingCrosscheckSlots: x.pending_crosscheck_slots, failedSlots: x.failed_slots,
    orchestratorVersion: x.orchestrator_version, routerVersion: x.router_version,
    retryContextVersion: x.retry_context_version, lastResortVersion: x.last_resort_version,
    contentQualityVersion: x.content_quality_version, itemValidatorVersion: x.item_validator_version,
    crosscheckAdapterName: x.crosscheck_adapter_name, modelCalls: x.model_calls, retries: x.retries,
    fallbackCalls: x.fallback_calls, lastResortCalls: x.last_resort_calls,
    inputTokens: Number(x.input_tokens), outputTokens: Number(x.output_tokens),
    estimatedCostUsd: Number(x.estimated_cost_usd), actualCostUsd: Number(x.actual_cost_usd),
    costCeilingHit: x.cost_ceiling_hit, worksheetLatencyMs: x.worksheet_latency_ms,
    costEventRefs: x.cost_event_refs ?? [], createdAt: new Date(x.created_at).toISOString(),
  };
}
function rowToSlot(x: any): WorksheetSlotRecord {
  return {
    id: x.id, runId: x.run_id, generationSpecId: x.generation_spec_id, itemId: x.item_id, index: x.index,
    kernelFamily: x.kernel_family, initialRole: x.initial_role, routeReason: x.route_reason,
    finalState: x.final_state, lastResortUsed: x.last_resort_used, crosscheckRequired: x.crosscheck_required,
    crosscheckVerdict: x.crosscheck_verdict, contentQualityCodes: x.content_quality_codes ?? [],
    reviewQueueId: x.review_queue_id, answerStatus: x.answer_status, productionReady: x.production_ready,
    slotLatencyMs: x.slot_latency_ms,
  };
}
function rowToAttempt(x: any): WorksheetSlotAttemptRecord {
  return {
    id: x.id, runId: x.run_id, itemId: x.item_id, attempt: x.attempt, model: x.model, role: x.role,
    step: x.step, accepted: x.accepted, failureCategory: x.failure_category, retryReason: x.retry_reason,
    latencyMs: x.latency_ms,
  };
}
