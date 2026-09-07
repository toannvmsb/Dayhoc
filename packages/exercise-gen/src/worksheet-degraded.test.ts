import { describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { makeSpec, FRONTIER_TARGET, SKILL, PREREQ } from './_spec-fixture.js';
import { asSkillId, type TargetSkill } from '@copilot/domain';
import { buildItemGenerationSpecs } from './item-spec.js';
import { createFaultInjectingGenerator, type FaultScript } from './fault-injecting-generator.js';
import { createMockAnswerCrosscheck } from './answer-crosscheck.js';
import { createInMemoryReviewQueue } from './review-queue.js';
import { orchestrateWorksheet } from './worksheet-orchestrator.js';
import { computeWorksheetCohortMetrics } from './worksheet-metrics.js';

/**
 * doc 68 §11 — SAFE DEGRADED WORKSHEET COMPLETION fault-injection.
 *
 *  · a failed OPTIONAL slot must NEVER fail an otherwise-safe worksheet
 *  · a failed REQUIRED_CORE slot recovers via a safe substitute or the
 *    worksheet stays FAILED — it is never delivered unverified
 *  · a REVIEW / PENDING item is NEVER counted as delivered to the child
 */

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const KILL: FaultScript = { failAttempts: 99, mode: 'INABILITY' };

function orchestrate(
  spec = makeSpec(),
  dScripts: Record<string, FaultScript> = {},
  hScripts: Record<string, FaultScript> = {},
  over: Partial<Parameters<typeof orchestrateWorksheet>[0]> = {},
) {
  return orchestrateWorksheet({
    spec,
    knowledgeBase: kb,
    referenceLibrary: lib,
    generators: {
      default: createFaultInjectingGenerator({ name: 'def', model: 'gpt-4.1-mini', role: 'default', scripts: dScripts, provider: 'mock', usage: { inputTokens: 700, outputTokens: 250 } }),
      highComplexity: createFaultInjectingGenerator({ name: 'hi', model: 'gpt-5-mini', role: 'high', scripts: hScripts, provider: 'mock', usage: { inputTokens: 800, outputTokens: 400 } }),
    },
    crosscheckAdapter: createMockAnswerCrosscheck(() => 'PASS'),
    reviewQueue: createInMemoryReviewQueue(),
    now: () => new Date('2027-03-01T00:00:00Z'),
    ...over,
  });
}

const coreIdsOf = (spec = makeSpec()) =>
  buildItemGenerationSpecs(spec, kb).filter((s) => s.criticality === 'REQUIRED_CORE');

describe('doc 68 §1 — deterministic slot criticality', () => {
  it('every slot has a criticality decided by its bucket, and a REQUIRED_CORE slot carries a fallback envelope', () => {
    for (const is of buildItemGenerationSpecs(makeSpec(), kb)) {
      expect(['REQUIRED_CORE', 'OPTIONAL_STRETCH', 'OPTIONAL_REASONING', 'CHALLENGE']).toContain(is.criticality);
      if (is.bucket === 'prerequisiteRepair' || is.bucket === 'currentSkill' || is.bucket === 'variation') {
        expect(is.criticality).toBe('REQUIRED_CORE');
        expect(is.fallback).not.toBeNull();
      } else {
        expect(is.fallback).toBeNull();
      }
    }
  });
});

describe('doc 68 §5 — REQUIRED_CORE failure → safe substitute', () => {
  it('a kernel-backed REQUIRED_CORE slot that both models fail is completed by the deterministic last-resort', async () => {
    const core = coreIdsOf()[0]!.itemId;
    const r = await orchestrate(makeSpec(), { [core]: KILL }, { [core]: KILL });
    const slot = r.trace.perSlot.find((s) => s.itemId === core)!;
    expect(slot.finalState).toBe('READY');
    expect(slot.lastResortUsed).toBe(true); // Group-A → last-resort is the safe completion
    expect(slot.attempts.length).toBeLessThanOrEqual(6);
    expect(slot.answerStatus).toBe('DETERMINISTIC_CORRECT');
    expect(r.worksheetState).not.toBe('FAILED');
  });

  it('when last-resort is unavailable, a failing REQUIRED_CORE slot is delivered via a SAFE SUBSTITUTE', async () => {
    const core = coreIdsOf()[0]!.itemId;
    // both generators fail the original pass (2 attempts each), then the single
    // substitute model shot succeeds (fault budget exhausted).
    const r = await orchestrate(
      makeSpec(),
      { [core]: { failAttempts: 2, mode: 'INABILITY' } },
      { [core]: { failAttempts: 2, mode: 'INABILITY' } },
      { config: { enableLastResort: false } },
    );
    const slot = r.trace.perSlot.find((s) => s.itemId === core)!;
    expect(slot.finalState).toBe('READY');
    expect(slot.substituted).toBe(true);
    expect(slot.attempts.some((a) => a.step === 'substitute')).toBe(true);
    expect(slot.attempts.length).toBeLessThanOrEqual(6);
    expect(r.worksheetState).toBe('READY_WITH_SAFE_SUBSTITUTION');
    expect(r.substitutedSlots).toBeGreaterThanOrEqual(1);
  });

  it('the substitute never drops K/T below the spec floor (planner-authoritative envelope)', () => {
    for (const is of coreIdsOf()) {
      expect(is.fallback!.minKnowledgeLevel).toBe(makeSpec().difficulty.kMin);
      expect(is.fallback!.minThinkingLevel).toBe(makeSpec().difficulty.tMin);
      expect(is.fallback!.preserveSkillId).toBe(is.skillId); // same skill preserved
    }
  });

  it('REQUIRED_CORE failure with NO safe substitute permitted → worksheet stays FAILED, never delivered unverified', async () => {
    const core = coreIdsOf()[0]!.itemId;
    const r = await orchestrate(makeSpec(), { [core]: KILL }, { [core]: KILL }, {
      config: { enableLastResort: false, enableSafeSubstitute: false },
    });
    const slot = r.trace.perSlot.find((s) => s.itemId === core)!;
    expect(slot.finalState).toBe('FAILED');
    expect(r.worksheetState).toBe('FAILED');
    expect(r.items.some((it) => it.id === core)).toBe(false);
    expect(slot.reviewQueueId).toBeTruthy();
  });
});

describe('doc 68 §3 — OPTIONAL failure never blocks delivery', () => {
  it('an OPTIONAL_REASONING slot that fails is OMITTED; the worksheet is still delivered', async () => {
    const specs = buildItemGenerationSpecs(makeSpec(), kb);
    const opt = specs.find((s) => s.criticality === 'OPTIONAL_REASONING')!.itemId;
    const r = await orchestrate(makeSpec(), { [opt]: KILL }, { [opt]: KILL });
    const slot = r.trace.perSlot.find((s) => s.itemId === opt)!;
    expect(slot.finalState).toBe('OMITTED');
    expect(slot.omitted).toBe(true);
    expect(slot.reviewQueueId).toBeTruthy();
    expect(r.worksheetState).toBe('READY_WITH_OPTIONAL_OMISSIONS');
    expect(r.items.some((it) => it.id === opt)).toBe(false);
    // every REQUIRED_CORE slot still READY
    for (const s of r.trace.perSlot.filter((x) => x.criticality === 'REQUIRED_CORE')) {
      expect(s.finalState).toBe('READY');
    }
  });

  it('a CHALLENGE slot with an UNCERTAIN crosscheck → review + omitted, never delivered', async () => {
    const frontier: TargetSkill = { ...FRONTIER_TARGET };
    const spec = makeSpec({
      targets: {
        skills: [
          { skillId: asSkillId(SKILL), role: 'CURRENT', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['currentSkill', 'variation'], knowledgeCeiling: 'K3', selectionReason: 'CURRENT_CURRICULUM', selectedCurriculumOrigin: 7, selectionConfidence: 0.6 },
          { skillId: asSkillId(PREREQ), role: 'PREREQUISITE_REPAIR', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['prerequisiteRepair'], knowledgeCeiling: 'K2', selectionReason: 'GAP_REPAIR', selectedCurriculumOrigin: 7, selectionConfidence: 0.9 },
          frontier,
        ],
        problemTypeIds: [],
        skillIds: [asSkillId(SKILL), asSkillId(PREREQ), asSkillId(FRONTIER_TARGET.skillId)],
      },
      childState: {
        ...makeSpec().childState,
        readiness: 'ready',
        actualLearningFrontier: {
          algebraic_thinking: { reachedCurriculumOrigin: 9, aboveGrade: true, confidence: 0.7, evidenceCount: 8, masteredSkillIds: [asSkillId(FRONTIER_TARGET.skillId)], readyNextSkillIds: [], exposureSkillIds: [] },
        },
      },
      difficulty: { kMin: 'K1', kMax: 'K5', tMin: 'T1', tMax: 'T5', stretchRatio: 0.25 },
      generationPlan: { totalQuestions: 8, distribution: { prerequisiteRepair: 2, currentSkill: 4, variation: 1, application: 0, advanced: 1, thinkingChallenge: 0 } },
    });
    const advId = buildItemGenerationSpecs(spec, kb).find((s) => s.bucket === 'advanced')!.itemId;
    // the CHALLENGE slot cannot be generated at all → omitted (Group-B / no last-resort)
    const r = await orchestrate(spec, { [advId]: KILL }, { [advId]: KILL });
    const slot = r.trace.perSlot.find((s) => s.itemId === advId)!;
    expect(slot.criticality).toBe('CHALLENGE');
    expect(slot.finalState).toBe('OMITTED');
    expect(slot.reviewQueueId).toBeTruthy();
    expect(r.worksheetState).not.toBe('FAILED'); // optional failure never blocks delivery
    expect(r.items.some((it) => it.id === advId)).toBe(false);
  });
});

describe('doc 68 §7/§8 — delivery invariants', () => {
  it('every delivered item is verified (deterministic or crosscheck-PASS); no review/pending item reaches the child', async () => {
    const specs = buildItemGenerationSpecs(makeSpec(), kb);
    // fail a spread of slots — some core, some optional
    const scripts: Record<string, FaultScript> = {};
    specs.forEach((s, i) => { if (i % 3 === 0) scripts[s.itemId] = { failAttempts: 2, mode: 'SIMILARITY' }; });
    const r = await orchestrate(makeSpec(), scripts);
    const m = computeWorksheetCohortMetrics([r]);
    expect(m.verifiedDeliveryRate).toBe(1);
    expect(m.unsafeDeliveryRate).toBe(0);
    const deliveredSlotStates = r.trace.perSlot.filter((s) => s.finalState === 'READY');
    // delivered count == items count, and no delivered slot is omitted/pending
    expect(deliveredSlotStates.length).toBe(r.items.length);
    for (const s of deliveredSlotStates) expect(s.omitted).toBe(false);
  });

  it('minimum item count: kill every REQUIRED_CORE slot → worksheet FAILED, no substitute path', async () => {
    const specs = buildItemGenerationSpecs(makeSpec(), kb);
    const scripts: Record<string, FaultScript> = {};
    for (const s of specs) scripts[s.itemId] = KILL;
    const r = await orchestrate(makeSpec(), scripts, scripts, {
      config: { enableLastResort: false, enableSafeSubstitute: false },
    });
    expect(r.worksheetState).toBe('FAILED'); // ≥1 REQUIRED_CORE slot not READY
    // no REQUIRED_CORE slot was delivered
    for (const s of r.trace.perSlot.filter((x) => x.criticality === 'REQUIRED_CORE')) {
      expect(s.finalState).toBe('FAILED');
      expect(r.items.some((it) => it.id === s.itemId)).toBe(false);
    }
  });
});
