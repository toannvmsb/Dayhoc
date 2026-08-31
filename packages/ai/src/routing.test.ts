import { describe, expect, it } from 'vitest';
import {
  AI_OPERATIONS,
  cheapPathShare,
  LLM_NEVER_OWNS,
  resolveRoute,
  ROUTING_MATRIX,
} from './routing.js';

describe('model routing matrix (§3, §4)', () => {
  it('covers every operation and every escalation target is a known tier', () => {
    for (const op of AI_OPERATIONS) {
      const rule = ROUTING_MATRIX[op];
      expect(rule.operation).toBe(op);
      expect(['deterministic', 'question_bank', 'cache', 'luna', 'ocr_assist', 'advanced', 'offline_qa']).toContain(rule.primary);
    }
  });

  it('Luna-first: standard operations start on Luna / deterministic / the bank', () => {
    expect(resolveRoute('vision_extract').tier).toBe('luna');
    expect(resolveRoute('skill_map').tier).toBe('luna');
    expect(resolveRoute('parent_summary').tier).toBe('luna');
    expect(resolveRoute('diagnose').tier).toBe('deterministic');
    expect(resolveRoute('generate_standard', { questionBankHit: true }).tier).toBe('question_bank');
  });

  it('low vision confidence escalates extraction to OCR assist', () => {
    const d = resolveRoute('vision_extract', { confidence: 0.4, escalateBelowConfidence: 0.6 });
    expect(d.tier).toBe('ocr_assist');
    expect(d.escalated).toBe(true);
    expect(d.reason).toContain('low_confidence');
  });

  it('handwriting / math layout escalate extraction even at ok confidence', () => {
    expect(resolveRoute('vision_extract', { handwriting: true }).tier).toBe('ocr_assist');
    expect(resolveRoute('vision_extract', { mathLayout: true }).tier).toBe('ocr_assist');
  });

  it('conflicting evidence / complex root cause routes diagnosis to the advanced tier', () => {
    const d = resolveRoute('diagnose', { conflictingEvidence: true });
    expect(d.tier).toBe('advanced');
    expect(d.advancedModelPending).toBe(true); // Sonnet-5 vs Terra not chosen yet (§3.2)
  });

  it('K4/K5 or T4/T5 advanced-question generation escalates past the bank', () => {
    expect(resolveRoute('generate_advanced', { thinkingLevel: 'T5' }).tier).toBe('advanced');
    expect(resolveRoute('generate_advanced', { knowledgeLevel: 'K4' }).tier).toBe('advanced');
  });

  it('a verified question-bank hit keeps generation off the model', () => {
    const d = resolveRoute('generate_advanced', { questionBankHit: true });
    expect(d.tier).toBe('question_bank');
    expect(d.escalated).toBe(false);
  });

  it('advancedModelPending clears once a benchmarked model is chosen', () => {
    const d = resolveRoute('diagnose', { conflictingEvidence: true }, { advancedModelChosen: true });
    expect(d.tier).toBe('advanced');
    expect(d.advancedModelPending).toBe(false);
  });

  it('golden_eval never escalates live (offline only)', () => {
    expect(ROUTING_MATRIX.golden_eval.escalateTo).toBeNull();
    expect(resolveRoute('golden_eval', { verifierDisagreement: true }).tier).toBe('offline_qa');
  });

  it('the deterministic-ownership list is explicit and complete', () => {
    expect(LLM_NEVER_OWNS).toContain('production_skill_ids');
    expect(LLM_NEVER_OWNS).toContain('mastery_formula');
    expect(LLM_NEVER_OWNS).toContain('billing_quota_enforcement');
    expect(LLM_NEVER_OWNS).toContain('gap_lifecycle_thresholds');
  });

  it('cheapPathShare: a realistic mix stays ≥ 85% off the advanced model (§3.1)', () => {
    const batch = [
      ...Array.from({ length: 40 }, () => resolveRoute('vision_extract')),
      ...Array.from({ length: 30 }, () => resolveRoute('skill_map')),
      ...Array.from({ length: 20 }, () => resolveRoute('parent_summary')),
      ...Array.from({ length: 7 }, () => resolveRoute('generate_advanced', { questionBankHit: true })),
      ...Array.from({ length: 3 }, () => resolveRoute('diagnose', { conflictingEvidence: true })),
    ];
    expect(cheapPathShare(batch)).toBeGreaterThanOrEqual(0.85);
  });
});
