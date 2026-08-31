import { describe, expect, it, vi } from 'vitest';
import { asChildId, asSkillId } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan } from '@copilot/planning';
import { computeReadiness, DEFAULT_GAP_CONFIG } from '@copilot/gap-engine';
import { AiOrchestrator, MockLlmProvider } from '@copilot/ai';
import { traceGap } from '@copilot/audit';
import { createApi } from '@copilot/api';
import { classificationSchemaV1 } from '@copilot/schemas';
import { KB, buildEvidence } from './harness.js';

const childId = asChildId('dod_child');
const asOf = new Date('2026-08-31T09:00:00Z');

/**
 * DoD MVP checklist (Roadmap Phase 10) as executable assertions.
 */
describe('Definition of Done — MVP', () => {
  it('parent can build a Learning Context with NO teacher participation', () => {
    const evidence = buildEvidence(
      childId,
      [{ skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 4, correct: true, source: 'notebook_scan', provenance: 'scan' }],
      asOf,
    );
    const ctx = buildLearningContext({ childId, gradeContext: 7, evidence, teacherContributions: [], knowledgeBase: KB, asOf });
    expect(ctx.teacherParticipated).toBe(false);
    expect(ctx.activeSkillIds.length).toBeGreaterThan(0);
  });

  it('child only ever sees tasks — the API refuses parent views to a child token', async () => {
    const api = createApi({
      knowledgeBase: KB,
      now: () => asOf,
      childProfiles: {
        c1: { profile: { childId: 'c1', displayName: 'A', schoolGrade: 7, schoolContext: 'KNTT' }, gradeContext: 7, familyUserIds: ['p1'] },
      },
    });
    await expect(api.parentHome({ userId: 'x', role: 'child', childScope: 'c1' }, 'c1')).rejects.toThrow();
    const today = await api.childToday({ userId: 'x', role: 'child', childScope: 'c1' }, 'c1');
    expect(today).not.toHaveProperty('mastery');
  });

  it('engine supports above-grade exposure + parallel gap repair', () => {
    const evidence = buildEvidence(
      childId,
      [
        { skillId: 'M7.ALG.IDENTITY', daysAgo: 10, correct: true, confidenceTier: 'A' }, // origin 8
        { skillId: 'M7.ALG.IDENTITY', daysAgo: 4, correct: true, confidenceTier: 'A' },
        // M7.QNUM.OPERATIONS: a moderate (not critical) prerequisite dip
        { skillId: 'M7.QNUM.OPERATIONS', daysAgo: 12, correct: true, confidenceTier: 'A' },
        { skillId: 'M7.QNUM.OPERATIONS', daysAgo: 8, correct: true },
        { skillId: 'M7.QNUM.OPERATIONS', daysAgo: 3, correct: false, reasoningQuality: 'weak' },
      ],
      asOf,
    );
    const twin = buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: KB, asOf });
    const algebra = twin.frontier.find((f) => f.domain === 'algebraic_thinking')!;
    expect(algebra.aboveGrade).toBe(true); // above-grade exposure tracked

    // M7.RATIO.PROPORTION's direct prerequisite is the (moderately weak) M7.QNUM.OPERATIONS
    const readiness = computeReadiness(childId, asSkillId('M7.RATIO.PROPORTION'), twin, KB, DEFAULT_GAP_CONFIG);
    expect(['ready', 'parallel_repair']).toContain(readiness.recommendation); // advanced path not force-stopped
  });

  it('every recommendation is traceable to raw evidence', () => {
    const evidence = buildEvidence(
      childId,
      [
        { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 22, correct: true, confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 8, correct: false, reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
        { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: false, reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
      ],
      asOf,
    );
    const twin = buildLearningTwin({ childId, gradeContext: 4, evidence, knowledgeBase: KB, asOf });
    const gaps = runGapEngine({ childId, gradeContext: 4, twin, evidence, knowledgeBase: KB, asOf });
    const g = gaps.gaps.find((x) => x.type !== 'careless_error')!;
    const trace = traceGap(g.id, gaps, evidence, KB)!;
    expect(trace.evidence.length).toBeGreaterThan(0);
    expect(trace.deterministicRule.length).toBeGreaterThan(0);
    expect(trace.scoreBreakdown).toBeDefined();
  });

  it('golden pipeline is deterministic (same evidence → same plan)', () => {
    const evidence = buildEvidence(childId, [{ skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 5, correct: false, reasoningQuality: 'weak' }], asOf);
    const run = () => {
      const twin = buildLearningTwin({ childId, gradeContext: 4, evidence, knowledgeBase: KB, asOf });
      const gaps = runGapEngine({ childId, gradeContext: 4, twin, evidence, knowledgeBase: KB, asOf, newId: (() => { let i = 0; return () => `${++i}`; })() });
      const context = buildLearningContext({ childId, gradeContext: 4, evidence, teacherContributions: [], knowledgeBase: KB, asOf });
      return buildDailyPlan({ childId, planDate: '2026-08-31', availableMinutes: 25, twin, gaps, context, knowledgeBase: KB, asOf });
    };
    expect(run()).toEqual(run());
  });

  it('AI cost / latency is tracked and invalid AI output never reaches the engine', async () => {
    const costSink = vi.fn();
    const orch = new AiOrchestrator({
      provider: new MockLlmProvider({ fallback: '{"nope": 1}' }),
      pricing: { inputPerMillion: 3, outputPerMillion: 15 },
      costSink,
      recordSink: vi.fn(),
    });
    const res = await orch.runStructured({
      operation: 'classify',
      request: { prompt: 'x' },
      schema: classificationSchemaV1,
      schemaVersion: 'classify.v1',
    });
    expect(res.ok).toBe(false); // engine gets issues, not the bad payload
    expect(costSink).toHaveBeenCalledOnce();
    expect(costSink.mock.calls[0]![0]).toHaveProperty('latencyMs');
    expect(costSink.mock.calls[0]![0]).toHaveProperty('costUsd');
  });
});
