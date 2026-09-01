import { describe, expect, it } from 'vitest';
import {
  AI_OPERATIONS,
  AIModelRouter,
  cheapPathShare,
  LLM_NEVER_OWNS,
  resolveRoute,
  ROUTING_MATRIX,
  ROUTING_TIERS,
} from './routing.js';

describe('AI model routing (Pricing v1.1 §7)', () => {
  it('covers every operation; every escalation target is a known tier', () => {
    for (const op of AI_OPERATIONS) {
      const rule = ROUTING_MATRIX[op];
      expect(rule.operation).toBe(op);
      expect(ROUTING_TIERS).toContain(rule.primary);
      if (rule.escalateTo) expect(ROUTING_TIERS).toContain(rule.escalateTo);
    }
  });

  it('there is no static question-bank tier anymore (AI-generation-first)', () => {
    expect(ROUTING_TIERS as readonly string[]).not.toContain('question_bank');
  });

  it('Luna-first: standard operations start on Luna / deterministic', () => {
    expect(resolveRoute('worksheet_batch_generation').tier).toBe('luna');
    expect(resolveRoute('next_best_question').tier).toBe('luna');
    expect(resolveRoute('vision_extraction').tier).toBe('luna');
    expect(resolveRoute('skill_map').tier).toBe('luna');
    expect(resolveRoute('parent_copilot').tier).toBe('luna');
    expect(resolveRoute('error_diagnosis').tier).toBe('deterministic');
  });

  it('low vision confidence escalates extraction to OCR assist', () => {
    const d = resolveRoute('vision_extraction', { confidence: 0.4, escalateBelowConfidence: 0.6 });
    expect(d.tier).toBe('ocr_assist');
    expect(d.escalated).toBe(true);
    expect(d.escalatedFrom).toBe('luna');
  });

  it('handwriting / math layout escalate extraction even at ok confidence', () => {
    expect(resolveRoute('vision_extraction', { handwriting: true }).tier).toBe('ocr_assist');
    expect(resolveRoute('vision_extraction', { mathLayout: true }).tier).toBe('ocr_assist');
  });

  it('K4/K5, T4/T5, HSG escalate generation to the advanced tier', () => {
    expect(resolveRoute('worksheet_batch_generation', { thinkingLevel: 'T5' }).tier).toBe('advanced');
    expect(resolveRoute('worksheet_batch_generation', { knowledgeLevel: 'K4' }).tier).toBe('advanced');
    expect(resolveRoute('next_best_question', { hsg: true }).tier).toBe('advanced');
  });

  it('conflicting evidence / complex root cause routes diagnosis to the advanced tier', () => {
    const d = resolveRoute('error_diagnosis', { conflictingEvidence: true });
    expect(d.tier).toBe('advanced');
    expect(d.advancedModelPending).toBe(true);
  });

  it('advanced tier with no model chosen → Luna at high effort + review flag (counts as cheap)', () => {
    const d = resolveRoute('error_diagnosis', { conflictingEvidence: true });
    expect(d.effectiveTier).toBe('luna');
    expect(d.effort).toBe('high');
    expect(d.reviewReason).toContain('luna_fallback');
    expect(cheapPathShare([d])).toBe(1);
  });

  it('once an advanced model is chosen, the advanced tier runs for real', () => {
    const r = new AIModelRouter({ advancedModelChosen: true });
    const d = r.route('error_diagnosis', { conflictingEvidence: true });
    expect(d.effectiveTier).toBe('advanced');
    expect(d.effort).toBe('standard');
    expect(d.reviewReason).toBeNull();
    expect(d.advancedModelPending).toBe(false);
  });

  it('the plan is NOT an input to the route (v1.1 non-negotiable)', () => {
    // resolveRoute has no `plan` parameter; the router exposes the assertion.
    expect(AIModelRouter.PLAN_DOES_NOT_SELECT_MODEL).toBe(true);
    expect(resolveRoute.length).toBeLessThanOrEqual(3); // operation, ctx, opts — no plan
  });

  it('golden_eval never escalates live (offline only)', () => {
    expect(ROUTING_MATRIX.golden_eval.escalateTo).toBeNull();
    expect(resolveRoute('golden_eval', { verifierDisagreement: true }).tier).toBe('offline_qa');
  });

  it('the deterministic-ownership list is explicit', () => {
    expect(LLM_NEVER_OWNS).toContain('production_skill_ids');
    expect(LLM_NEVER_OWNS).toContain('mastery_formula');
    expect(LLM_NEVER_OWNS).toContain('readiness_rules');
    expect(LLM_NEVER_OWNS).toContain('planner_constraints');
    expect(LLM_NEVER_OWNS).toContain('parent_goal');
  });

  it('cheapPathShare: a realistic mix stays ≥ 85% off the advanced model (§7)', () => {
    const batch = [
      ...Array.from({ length: 40 }, () => resolveRoute('vision_extraction')),
      ...Array.from({ length: 30 }, () => resolveRoute('worksheet_batch_generation')),
      ...Array.from({ length: 20 }, () => resolveRoute('parent_copilot')),
      ...Array.from({ length: 7 }, () => resolveRoute('next_best_question')),
      ...Array.from({ length: 3 }, () => resolveRoute('error_diagnosis', { conflictingEvidence: true })),
    ];
    expect(cheapPathShare(batch)).toBeGreaterThanOrEqual(0.85);
  });
});
