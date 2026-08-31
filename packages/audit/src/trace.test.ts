import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence, type GapId } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { traceGap, tracePrescription } from './trace.js';

const kb = loadKnowledgeBase();
const childId = asChildId('audit_child');
const asOf = new Date('2026-08-31T09:00:00Z');

function ev(i: number, skillId: string, daysAgo: number, correct: boolean, extra: Partial<Evidence> = {}): Evidence {
  const occurredAt = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${i}` as Evidence['id'],
    childId,
    source: 'app_practice',
    occurredAt,
    recordedAt: occurredAt,
    skillId: asSkillId(skillId),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
    ...extra,
  };
}

describe('recommendation audit trace (DoD: mọi khuyến nghị truy vết được)', () => {
  const evidence = [
    ev(1, 'M4.FRAC.EQUIVALENT', 24, true, { confidenceTier: 'A' }),
    ev(2, 'M4.FRAC.COMMON_DENOM', 9, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A', aiInferenceId: 'ai_scan_42' }),
    ev(3, 'M4.FRAC.COMMON_DENOM', 4, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
  ];
  const twin = buildLearningTwin({ childId, gradeContext: 4, evidence, knowledgeBase: kb, asOf });
  const engine = runGapEngine({ childId, gradeContext: 4, twin, evidence, knowledgeBase: kb, asOf });
  const gapId = engine.gaps.find((g) => g.type !== 'careless_error')!.id as GapId;

  it('resolves a gap to its rule, ruled-out alternatives, score, and cited evidence', () => {
    const trace = traceGap(gapId, engine, evidence, kb)!;
    expect(trace.deterministicRule).toMatch(/classifier/);
    expect(trace.rootSkillName.length).toBeGreaterThan(0);
    expect(trace.scoreBreakdown).toHaveProperty('score');
    expect(trace.evidence.length).toBeGreaterThan(0);
    expect(trace.evidence.every((e) => e.id.startsWith('ev_'))).toBe(true);
    expect(trace.provisionalCoefficients).toBe(true);
  });

  it('surfaces any AI inference id behind the cited evidence explicitly', () => {
    const trace = traceGap(gapId, engine, evidence, kb)!;
    if (trace.evidence.some((e) => e.aiInferenceId)) {
      expect(trace.aiInvolved).toContain('ai_scan_42');
    }
  });

  it('a prescription trace inherits the gap chain plus the dose rule', () => {
    const trace = tracePrescription(gapId, engine, evidence, kb);
    if (engine.prescriptions.some((p) => p.gapId === gapId)) {
      expect(trace).not.toBeNull();
      expect(trace!.kind).toBe('prescription');
      expect(trace!.deterministicRule).toMatch(/dose by gap type/);
    }
  });
});
