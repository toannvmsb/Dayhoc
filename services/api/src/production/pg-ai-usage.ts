import type { Pool } from 'pg';
import type { AiUsageEvent } from '@copilot/ai';

/**
 * Persist one `AiUsageEvent` to the canonical `ai_usage_events` ledger
 * (INSERT-only — the table carries `reject_ledger_mutation` triggers).
 * Pseudonymous refs only. Best-effort: a ledger write failure is logged by the
 * caller, never thrown into a request path.
 */
export async function insertAiUsageEvent(pool: Pool, e: AiUsageEvent): Promise<void> {
  await pool.query(
    `INSERT INTO ai_usage_events
       (user_ref, child_ref, plan, operation_type, provider, model, model_version,
        price_config_effective_date, input_tokens, cached_input_tokens, output_tokens,
        image_count, ocr_pages, estimated_cost_usd, estimated_cost_vnd,
        actual_cost_usd, actual_cost_vnd, latency_ms, confidence, retry_count,
        escalated_from, escalation_reason, generation_spec_id, learning_context_source,
        k_target, t_target, schema_valid, request_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
    [
      e.userRef, e.childRef, e.plan, e.operationType, e.provider, e.model, e.modelVersion,
      e.priceConfigEffectiveDate, e.inputTokens, e.cachedInputTokens, e.outputTokens,
      e.imageCount, e.ocrPages, e.estimatedCostUsd, e.estimatedCostVnd,
      e.actualCostUsd, e.actualCostVnd, e.latencyMs, e.confidence, e.retryCount,
      e.escalatedFrom, e.escalationReason, e.generationSpecId, e.learningContextSource,
      e.kTarget, e.tTarget, e.schemaValid, e.requestId, e.createdAt,
    ],
  );
}
