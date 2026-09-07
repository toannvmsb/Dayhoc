import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMockItemContentGenerator,
  createOpenAiAnswerCrosscheck,
  createRoutedAnswerCrosscheck,
  PgReviewQueueStore,
  PgWorksheetGenerationStore,
  runWorksheetShadow,
} from '@copilot/exercise-gen';
import {
  createOpenAiProviderAdapter,
  PricingRegistry,
  tokenCostUsd,
  type AiCapability,
  type ProviderCompliance,
} from '@copilot/ai';
import { asChildId, asSkillId, type ExerciseGenerationSpec } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { insertAiUsageEvent } from './pg-ai-usage.js';

/**
 * doc 67 §D5 — Group-C crosscheck LIVE in STAGING. The real routed verifier
 * (`gpt-4.1-mini` + `gpt-5-mini` for geometry) runs against MOCK-generated
 * Group-C reasoning items and persists to the staging Postgres — so generation
 * is FREE and only the crosscheck is paid.
 *
 * Verifies the LIVE wiring: the verifier actually runs (real OpenAI); PASS →
 * slot READY but `productionReady` STAYS false; UNCERTAIN → PENDING_CROSSCHECK
 * + a CROSSCHECK_UNCERTAIN review row — NEVER converted to PASS; crosscheck cost
 * → `ai_usage_events` as `advanced_verification`; spend within the sub-cap.
 *
 * Gated on RUN_D5_STAGING=1 + STAGING DATABASE_URL + OPENAI_API_KEY.
 * Hard crosscheck spend cap USD 0.20 (part of the pre-approved $0.50 budget).
 */
const LIVE =
  process.env.RUN_D5_STAGING === '1' && !!process.env.DATABASE_URL && !!process.env.OPENAI_API_KEY;
const CAP_USD = Number(process.env.D5_CAP_USD ?? '0.20');
const WORKSHEETS = Number(process.env.D5_WORKSHEETS ?? '6');
const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'staging-d5',
  crossBorder: true,
  dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy',
  trainingAllowed: false,
  dpaStatus: 'not_applicable',
};

/**
 * A hand-built spec with a THINKING target → a worksheet built from it has ≥1
 * Group-C (crosscheck-required) slot. (Trimmed copy of `@copilot/exercise-gen`'s
 * `_spec-fixture`, which is build-excluded and not exported.)
 */
const SKILL = 'M7.RATIO.EQUAL_CHAIN';
const PREREQ = 'M7.RATIO.PROPORTION';
function makeSpec(generationSpecId: string): ExerciseGenerationSpec {
  const skills = [
    { skillId: asSkillId(SKILL), role: 'CURRENT', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['currentSkill', 'variation', 'application'], knowledgeCeiling: 'K3', selectionReason: 'CURRENT_CURRICULUM', selectedCurriculumOrigin: 7, selectionConfidence: 0.58 },
    { skillId: asSkillId(PREREQ), role: 'PREREQUISITE_REPAIR', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['prerequisiteRepair'], knowledgeCeiling: 'K2', selectionReason: 'GAP_REPAIR', selectedCurriculumOrigin: 7, selectionConfidence: 0.9 },
    { skillId: asSkillId(SKILL), role: 'THINKING', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['thinkingChallenge'], knowledgeCeiling: 'K3', selectionReason: 'THINKING_STRETCH', selectedCurriculumOrigin: 7, selectionConfidence: 0.8 },
  ];
  return {
    generationSpecId,
    childId: asChildId('c4_child'),
    createdAt: '2027-01-25T09:00:00.000Z',
    schoolGrade: 7,
    learningContext: { curriculum: 'KET_NOI_TRI_THUC', expectedLessonId: 'C.G7.6.21', resolvedLessonId: 'C.G7.6.21', source: 'TEACHER_UPDATE', confidence: 'VERIFIED', isEstimated: false },
    goal: { parentGoal: 'kha_gioi', sessionGoal: 'lesson_practice' },
    targets: { skills, problemTypeIds: [], skillIds: [...new Set(skills.map((s) => s.skillId))] },
    childState: {
      relevantMastery: { [SKILL]: 58, [PREREQ]: 45 },
      prerequisiteGaps: [{ skillId: asSkillId(PREREQ), severity: 0.4, blocking: false }],
      readiness: 'parallel_repair',
      thinkingProfile: { algebraic_thinking: 'T3' },
      actualLearningFrontier: {
        algebraic_thinking: { reachedCurriculumOrigin: 7, aboveGrade: false, confidence: 0.5, evidenceCount: 6, masteredSkillIds: [asSkillId(SKILL), asSkillId(PREREQ)], readyNextSkillIds: [], exposureSkillIds: [] },
      },
    },
    generationPlan: { totalQuestions: 8, distribution: { prerequisiteRepair: 2, currentSkill: 3, variation: 1, application: 1, advanced: 0, thinkingChallenge: 1 } },
    difficulty: { kMin: 'K1', kMax: 'K3', tMin: 'T1', tMax: 'T4', stretchRatio: 0.25 },
    constraints: { noUnlearnedRequiredKnowledge: true, allowAboveGradeReasoning: true, requireUniqueVariants: true, language: 'vi', ageAppropriate: true, maxSolutionComplexity: 'standard' },
    provenance: { plannerVersion: 'exercise-spec.v1', targetSelectorVersion: 'target-selector.v2', curriculumRevision: 'math-dev-core-1.0', curriculumContentHash: 'deadbeefcafe0001', twinVersion: '2027-01-25T09:00:00.000Z', gapSnapshotVersion: '2027-01-25T09:00:00.000Z' },
  } as unknown as ExerciseGenerationSpec;
}

describe.skipIf(!LIVE)('doc 67 §D5 — Group-C crosscheck LIVE (staging)', () => {
  let pool: import('pg').Pool;
  const specIds: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  });
  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      const scope = `generation_spec_id = ANY($1::text[])`;
      await c.query(`DELETE FROM review_queue WHERE ${scope}`, [specIds]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE ${scope})`, [specIds]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slots WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE ${scope})`, [specIds]).catch(() => {});
      await c.query(`DELETE FROM worksheet_generation_runs WHERE ${scope}`, [specIds]).catch(() => {});
      await c.query(`DELETE FROM ai_usage_events WHERE ${scope}`, [specIds]).catch(() => {});
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it(`${WORKSHEETS} SHADOW worksheets, LIVE crosscheck, spend ≤ $${CAP_USD}, UNCERTAIN never becomes PASS`, async () => {
    const kb = loadKnowledgeBase();
    const lib = loadReferenceLibrary();
    const pricing = new PricingRegistry();
    const store = new PgWorksheetGenerationStore(pool);
    const reviewQueue = new PgReviewQueueStore(pool);
    let spentUsd = 0;

    const mkCc = (model: string) =>
      createOpenAiAnswerCrosscheck(
        createOpenAiProviderAdapter({
          apiKey: process.env.OPENAI_API_KEY!,
          model,
          capability: 'advanced_verification' as AiCapability,
          compliance: COMPLIANCE,
        }),
      );
    const meter = (inner: ReturnType<typeof mkCc>) => ({
      name: inner.name,
      async crosscheck(req: Parameters<typeof inner.crosscheck>[0]) {
        if (spentUsd > CAP_USD) return { verdict: 'UNCERTAIN' as const, confidence: 0, detail: 'D5 cap reached' };
        const out = await inner.crosscheck(req);
        if (out.usage && pricing.has(out.usage.model)) {
          spentUsd += tokenCostUsd(pricing.priceAt(out.usage.model, new Date()), {
            inputTokens: out.usage.inputTokens,
            outputTokens: out.usage.outputTokens,
          });
        }
        return out;
      },
    });
    const crosscheckAdapter = createRoutedAnswerCrosscheck({
      base: meter(mkCc(process.env.CROSSCHECK_MODEL ?? 'gpt-4.1-mini')),
      geometryProof: meter(mkCc(process.env.CROSSCHECK_GEOMETRY_MODEL ?? 'gpt-5-mini')),
    });
    const gen = createMockItemContentGenerator();

    let groupC = 0;
    let ready = 0;
    let pending = 0;
    let verifierCalls = 0;
    const verdicts: string[] = [];

    for (let i = 0; i < WORKSHEETS; i += 1) {
      const spec = makeSpec(`d5-${Date.now()}-${i}`);
      specIds.push(spec.generationSpecId);
      const outcome = await runWorksheetShadow('SHADOW', {
        spec,
        knowledgeBase: kb,
        referenceLibrary: lib,
        generators: { default: gen, highComplexity: gen },
        crosscheckAdapter,
        reviewQueue,
        store,
        childRef: 'c_d5',
        usageContext: { userRef: 'u_d5', childRef: 'c_d5', plan: 'plus' as const },
        usageSink: (e) => void insertAiUsageEvent(pool, e).catch(() => undefined),
      });
      expect(outcome.ran).toBe(true);
      if (!outcome.ran) continue;

      for (const s of outcome.result.trace.perSlot) {
        if (!s.crosscheckRequired) continue;
        groupC += 1;
        if (s.crosscheckVerdict) verdicts.push(s.crosscheckVerdict);
        if (s.finalState === 'READY') {
          ready += 1;
          expect(s.productionReady).toBe(false); // AI-verified ≠ deterministic
          expect(s.crosscheckVerdict).toBe('PASS');
        }
        // doc 68 §7 — a non-PASS Group-C slot is never delivered: an optional slot
        // is OMITTED (review row), a REQUIRED_CORE slot goes to a safe substitute.
        if (s.finalState === 'OMITTED') {
          pending += 1;
          expect(s.productionReady).toBe(false);
          expect(s.crosscheckVerdict).not.toBe('PASS'); // UNCERTAIN never becomes PASS
          expect(s.omitted).toBe(true);
        }
      }
      for (const m of outcome.result.trace.totals.byModel) {
        if (m.operationType === 'advanced_verification') verifierCalls += m.calls;
      }
    }

    expect(groupC).toBeGreaterThan(0);
    expect(verifierCalls).toBeGreaterThan(0);

    const ledger = await pool.query<{ n: string }>(
      `SELECT count(*)::int n FROM ai_usage_events
        WHERE operation_type = 'advanced_verification' AND generation_spec_id = ANY($1::text[])`,
      [specIds],
    );
    expect(Number(ledger.rows[0]!.n)).toBeGreaterThan(0);

    // a CROSSCHECK_UNCERTAIN review row for every omitted-on-UNCERTAIN slot — never a PASS
    const rq = await pool.query<{ n: string }>(
      `SELECT count(*)::int n FROM review_queue
        WHERE generation_spec_id = ANY($1::text[]) AND reason = 'CROSSCHECK_UNCERTAIN'`,
      [specIds],
    );
    expect(Number(rq.rows[0]!.n)).toBeGreaterThanOrEqual(pending);

    expect(spentUsd).toBeLessThanOrEqual(CAP_USD + 0.02);

    console.log(
      `D5: worksheets=${WORKSHEETS} groupC=${groupC} READY(PASS)=${ready} PENDING=${pending} verdicts=${verdicts.join(',')} verifierCalls=${verifierCalls} spend=$${spentUsd.toFixed(4)}/$${CAP_USD}`,
    );
  }, 20 * 60 * 1000);
});
