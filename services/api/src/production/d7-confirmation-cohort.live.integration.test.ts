import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  createLunaItemContentGenerator,
  createOpenAiAnswerCrosscheck,
  createRoutedAnswerCrosscheck,
  DailyCostGuard,
  PgReviewQueueStore,
  PgWorksheetGenerationStore,
  PgWorksheetJobQueue,
  WorksheetJobWorker,
  type AiUsageEvent,
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
 * doc 67 §D7 — FINAL CONFIRMATION COHORT. ~30 representative worksheets through
 * the full staging path (durable queue → real Luna generation → MathKernel /
 * validator / routing / retry / fallback / last-resort → LIVE routed Group-C
 * crosscheck → review queue → staging Postgres → cost ledger), synthetic specs
 * only.
 *
 * Axes covered: G4 + G7 · arithmetic · fractions · word problems · LINEAR_EQ ·
 * frontier (above-grade) · reasoning (thinkingChallenge) · Group C · geometry.
 *
 * PAID GENERATION. Gated on RUN_D7=1 + STAGING DATABASE_URL + OPENAI_API_KEY.
 * The hard cap comes from D7_GEN_CAP_USD (no default — the run refuses to start
 * without an explicit budget) and D7_XCHECK_CAP_USD (default 0.25).
 *
 * Exit gates (asserted): kernel deterministic correctness = 100% · 0 wrong
 * accepted · 0 silent semantic contradiction · Group-C false-PASS pathway
 * (UNCERTAIN never → PASS) · bounded retry/fallback · spend within the caps.
 */
// D7B FINAL confirmation (doc 68 §12 / final directive §1): dedicated caps.
const GEN_CAP = Number(
  process.env.D7B_FINAL_GEN_CAP_USD ?? process.env.D7B_GEN_CAP_USD ?? process.env.D7_GEN_CAP_USD ?? 'NaN',
);
const XCHECK_CAP = Number(
  process.env.D7B_FINAL_CROSSCHECK_CAP_USD ?? process.env.D7B_CROSSCHECK_CAP_USD ?? process.env.D7_XCHECK_CAP_USD ?? '0.15',
);
const LIVE =
  (process.env.RUN_D7B_FINAL === '1' || process.env.RUN_D7B === '1' || process.env.RUN_D7 === '1') &&
  !!process.env.DATABASE_URL &&
  !!process.env.OPENAI_API_KEY &&
  Number.isFinite(GEN_CAP) &&
  GEN_CAP > 0;
// per-run nonce so a re-run never replays a prior cohort's persisted rows (§2).
const RUN_TAG = process.env.D7_RUN_TAG ?? `r${Date.now().toString(36)}`;
const OUT = 'D:/Lap trinh/Claude/Dayhoc/D7_COHORT.txt';
const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'staging-d7', crossBorder: true, dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy', trainingAllowed: false, dpaStatus: 'not_applicable',
};

type Axis =
  | 'g4_arith' | 'g4_frac' | 'g4_word' | 'g7_linear_eq' | 'g7_ratio'
  | 'g7_frontier' | 'g7_geometry' | 'g4_reasoning';

interface Tgt {
  skillId: string; role: string; domain: string; curriculumOrigin: number;
  buckets: readonly string[]; knowledgeCeiling: string; selectionReason: string;
  selectedCurriculumOrigin: number; selectionConfidence: number;
}
const t = (o: Partial<Tgt> & { skillId: string; role: string; domain: string; buckets: readonly string[] }): Tgt => ({
  curriculumOrigin: 4, knowledgeCeiling: 'K3', selectionReason: 'CURRENT_CURRICULUM',
  selectedCurriculumOrigin: o.curriculumOrigin ?? 4, selectionConfidence: 0.6, ...o,
});

/** one synthetic spec per axis. */
function specForAxis(axis: Axis, id: string): ExerciseGenerationSpec {
  const base = {
    generationSpecId: id,
    childId: asChildId(`d7_${axis}`),
    createdAt: '2027-01-25T09:00:00.000Z',
    goal: { parentGoal: 'theo_sat_chuong_trinh', sessionGoal: 'lesson_practice' },
    difficulty: { kMin: 'K1', kMax: 'K3', tMin: 'T1', tMax: 'T4', stretchRatio: 0.25 },
    constraints: { noUnlearnedRequiredKnowledge: true, allowAboveGradeReasoning: true, requireUniqueVariants: true, language: 'vi', ageAppropriate: true, maxSolutionComplexity: 'standard' },
    provenance: { plannerVersion: 'exercise-spec.v1', targetSelectorVersion: 'target-selector.v2', curriculumRevision: 'math-dev-core-1.0', curriculumContentHash: 'deadbeefcafe0007', twinVersion: '2027-01-25T09:00:00.000Z', gapSnapshotVersion: '2027-01-25T09:00:00.000Z' },
  };
  // The synthetic spec's difficulty envelope MUST be consistent with the buckets
  // it requests — the same rule the real planner's `deriveDifficulty` enforces:
  //  · a FRONTIER target lifts kMax to that target's knowledgeCeiling (K5 here);
  //  · a THINKING target / an advanced parentGoal lets tMax reach T5.
  // Without this, the generator produces a correct K5 frontier / T5 thinking item
  // and the validator (correctly) rejects it as out-of-envelope — a fixture bug,
  // not a pipeline defect. (doc 67 §D7 diagnostic 2026-09-07.)
  const mk = (
    grade: number, lesson: string, domain: string, skills: Tgt[],
    dist: Record<string, number>, mastery: Record<string, number>,
    envelope?: { kMax?: string; tMax?: string; parentGoal?: string },
  ): ExerciseGenerationSpec => ({
    ...base, schoolGrade: grade,
    goal: { ...base.goal, ...(envelope?.parentGoal ? { parentGoal: envelope.parentGoal } : {}) },
    difficulty: { ...base.difficulty, ...(envelope?.kMax ? { kMax: envelope.kMax } : {}), ...(envelope?.tMax ? { tMax: envelope.tMax } : {}) },
    learningContext: { curriculum: 'KET_NOI_TRI_THUC', expectedLessonId: lesson, resolvedLessonId: lesson, source: 'TEACHER_UPDATE', confidence: 'VERIFIED', isEstimated: false },
    targets: { skills, problemTypeIds: [], skillIds: [...new Set(skills.map((s) => s.skillId))] },
    childState: {
      relevantMastery: mastery, prerequisiteGaps: [], readiness: 'ready',
      thinkingProfile: { [domain]: envelope?.tMax === 'T5' ? 'T4' : 'T3' },
      actualLearningFrontier: { [domain]: { reachedCurriculumOrigin: grade, aboveGrade: axis === 'g7_frontier', confidence: 0.6, evidenceCount: 6, masteredSkillIds: skills.map((s) => asSkillId(s.skillId)), readyNextSkillIds: [], exposureSkillIds: [] } },
    },
    // base = 6 REQUIRED_CORE (currentSkill+variation) + 1 OPTIONAL_STRETCH
    // (application); axes that want a reasoning / challenge slot add it explicitly
    // AND raise tMax/kMax to match (doc 68 §9 — no self-contradicting fixture).
    generationPlan: { totalQuestions: 8, distribution: { prerequisiteRepair: 0, currentSkill: 5, variation: 2, application: 1, advanced: 0, thinkingChallenge: 0, ...dist } },
  } as unknown as ExerciseGenerationSpec);

  switch (axis) {
    case 'g4_arith':
      return mk(4, 'C.G4.3.8', 'arithmetic', [t({ skillId: 'M4.ARITH.MUL_2DIGIT', role: 'CURRENT', domain: 'arithmetic', buckets: ['currentSkill', 'variation', 'application'] })], {}, { 'M4.ARITH.MUL_2DIGIT': 60 });
    case 'g4_frac':
      return mk(4, 'C.G4.10.6', 'fractions', [t({ skillId: 'M4.FRAC.ADD', role: 'CURRENT', domain: 'fractions', buckets: ['currentSkill', 'variation', 'application'] }), t({ skillId: 'M4.FRAC.SUB', role: 'CURRENT', domain: 'fractions', buckets: ['currentSkill'] })], {}, { 'M4.FRAC.ADD': 55, 'M4.FRAC.SUB': 50 });
    case 'g4_word':
      return mk(4, 'C.G4.5.12', 'word_problems', [t({ skillId: 'M4.WORD.SUM_DIFF', role: 'CURRENT', domain: 'word_problems', buckets: ['currentSkill', 'variation', 'application'] })], {}, { 'M4.WORD.SUM_DIFF': 58 });
    case 'g4_reasoning':
      return mk(4, 'C.G4.3.8', 'arithmetic', [t({ skillId: 'M4.ARITH.DISTRIBUTIVE', role: 'CURRENT', domain: 'arithmetic', buckets: ['currentSkill', 'variation'] }), t({ skillId: 'M4.ARITH.DISTRIBUTIVE', role: 'THINKING', domain: 'arithmetic', buckets: ['thinkingChallenge'], selectionReason: 'THINKING_STRETCH' })], { thinkingChallenge: 1, currentSkill: 4 }, { 'M4.ARITH.DISTRIBUTIVE': 62 }, { tMax: 'T5', parentGoal: 'phat_trien_tu_duy' });
    case 'g7_linear_eq':
      return mk(7, 'C.G7.3.9', 'algebraic_thinking', [t({ skillId: 'M7.ALG.LINEAR_EQ', role: 'CURRENT', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['currentSkill', 'variation', 'application'] })], {}, { 'M7.ALG.LINEAR_EQ': 57 });
    case 'g7_ratio':
      return mk(7, 'C.G7.6.21', 'algebraic_thinking', [t({ skillId: 'M7.QNUM.EQUAL_CHAIN', role: 'CURRENT', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['currentSkill', 'variation', 'application'] })], {}, { 'M7.QNUM.EQUAL_CHAIN': 56 });
    case 'g7_frontier':
      return mk(7, 'C.G7.6.21', 'algebraic_thinking', [
        t({ skillId: 'M7.QNUM.EQUAL_CHAIN', role: 'CURRENT', domain: 'algebraic_thinking', curriculumOrigin: 7, buckets: ['currentSkill', 'variation'] }),
        t({ skillId: 'M7.ALG.SYMMETRIC', role: 'FRONTIER', domain: 'algebraic_thinking', curriculumOrigin: 9, buckets: ['advanced'], knowledgeCeiling: 'K5', selectionReason: 'MASTERED_FRONTIER_STRETCH', selectedCurriculumOrigin: 9 }),
      ], { advanced: 1, currentSkill: 4, thinkingChallenge: 0 }, { 'M7.QNUM.EQUAL_CHAIN': 72, 'M7.ALG.SYMMETRIC': 70 }, { kMax: 'K5', tMax: 'T5', parentGoal: 'phat_trien_tu_duy' });
    case 'g7_geometry':
      return mk(7, 'C.G7.4.14', 'geometry', [
        t({ skillId: 'M7.GEO.PARALLEL_CRITERIA', role: 'CURRENT', domain: 'geometry', curriculumOrigin: 7, buckets: ['currentSkill', 'variation', 'application'] }),
        t({ skillId: 'M7.GEO.PARALLEL_CRITERIA', role: 'THINKING', domain: 'geometry', curriculumOrigin: 7, buckets: ['thinkingChallenge'], selectionReason: 'THINKING_STRETCH' }),
      ], { thinkingChallenge: 1, currentSkill: 4 }, { 'M7.GEO.PARALLEL_CRITERIA': 55 }, { tMax: 'T5', parentGoal: 'phat_trien_tu_duy' });
  }
}

const ALL_AXES_REG: Axis[] = ['g4_arith', 'g4_frac', 'g4_word', 'g4_reasoning', 'g7_linear_eq', 'g7_ratio', 'g7_frontier', 'g7_geometry'];
const KI = ['K0', 'K1', 'K2', 'K3', 'K4', 'K5'];
const TI = ['T1', 'T2', 'T3', 'T4', 'T5'];

/**
 * doc 68 §9 — regression: a synthetic D7 spec must never contradict its own
 * target slots. Every FRONTIER target's knowledgeCeiling must fit inside
 * difficulty.kMax, every THINKING bucket must allow tMax ≥ T5, and every pinned
 * item level must land inside the spec's own K/T envelope. This is exactly the
 * class of fixture bug that made D7 run 1 fail (kMax hard-coded to K3).
 */
describe('doc 68 §9 — D7 synthetic specs are self-consistent (always on)', () => {
  it.each(ALL_AXES_REG)('%s: difficulty envelope accommodates every target + bucket', async (axis) => {
    const { loadKnowledgeBase } = await import('@copilot/math-data');
    const { buildItemGenerationSpecs } = await import('@copilot/exercise-gen');
    const kb = loadKnowledgeBase();
    const spec = specForAxis(axis, `reg-${axis}`);
    const kMax = KI.indexOf(spec.difficulty.kMax);
    const tMax = TI.indexOf(spec.difficulty.tMax);
    const kMin = KI.indexOf(spec.difficulty.kMin);
    const tMin = TI.indexOf(spec.difficulty.tMin);

    for (const target of spec.targets.skills) {
      if (target.role === 'FRONTIER') {
        expect(KI.indexOf(target.knowledgeCeiling), `${axis}: FRONTIER ceiling ${target.knowledgeCeiling} > kMax ${spec.difficulty.kMax}`).toBeLessThanOrEqual(kMax);
      }
    }
    if (spec.generationPlan.distribution.thinkingChallenge > 0) {
      expect(tMax, `${axis}: thinkingChallenge bucket needs tMax ≥ T5`).toBeGreaterThanOrEqual(TI.indexOf('T5'));
    }
    // every pinned item lands inside the spec's own envelope
    for (const is of buildItemGenerationSpecs(spec, kb)) {
      expect(KI.indexOf(is.knowledgeLevel)).toBeGreaterThanOrEqual(kMin);
      expect(KI.indexOf(is.knowledgeLevel)).toBeLessThanOrEqual(kMax);
      expect(TI.indexOf(is.thinkingLevel)).toBeGreaterThanOrEqual(tMin);
      expect(TI.indexOf(is.thinkingLevel)).toBeLessThanOrEqual(tMax);
      // criticality is populated and bucket-derived
      expect(['REQUIRED_CORE', 'OPTIONAL_STRETCH', 'OPTIONAL_REASONING', 'CHALLENGE']).toContain(is.criticality);
    }
  });
});

describe.skipIf(!LIVE)('doc 67 §D7 — final confirmation cohort (staging, PAID generation)', () => {
  let pool: import('pg').Pool;
  const childRefs: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  });
  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      const specIds = (
        await c.query<{ generation_spec_id: string }>(
          `SELECT generation_spec_id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])
           UNION SELECT generation_spec_id FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`,
          [childRefs],
        )
      ).rows.map((x) => x.generation_spec_id);
      await c.query(`DELETE FROM worksheet_jobs WHERE child_ref = ANY($1::text[])`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM review_queue WHERE child_ref = ANY($1::text[]) OR generation_spec_id = ANY($2::text[])`, [childRefs, specIds]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[]))`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM worksheet_slots WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[]))`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])`, [childRefs]).catch(() => {});
      await c.query(`DELETE FROM ai_usage_events WHERE generation_spec_id = ANY($1::text[])`, [specIds]).catch(() => {});
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it(`~${(process.env.D7_RUNS ?? '30')} worksheets, gen ≤ $${GEN_CAP}, xcheck ≤ $${XCHECK_CAP}`, async () => {
    const kb = loadKnowledgeBase();
    const lib = loadReferenceLibrary();
    const pricing = new PricingRegistry();
    const RUNS = Number(process.env.D7_RUNS ?? '30');
    const ALL_AXES: Axis[] = ['g4_arith', 'g4_frac', 'g4_word', 'g4_reasoning', 'g7_linear_eq', 'g7_ratio', 'g7_frontier', 'g7_geometry'];
    // D7_AXES=g7_frontier,g7_geometry restricts the cohort (targeted re-validation)
    const axes: Axis[] = process.env.D7_AXES
      ? (process.env.D7_AXES.split(',').map((s) => s.trim()).filter((s) => ALL_AXES.includes(s as Axis)) as Axis[])
      : ALL_AXES;

    const mkGen = (model: string) =>
      createLunaItemContentGenerator({
        adapter: createOpenAiProviderAdapter({ apiKey: process.env.OPENAI_API_KEY!, model, capability: 'generate_problem' as AiCapability, compliance: COMPLIANCE }),
        structuredOutputMode: 'STRICT_JSON_SCHEMA',
      });
    const generators = { default: mkGen('gpt-4.1-mini'), highComplexity: mkGen('gpt-5-mini') };

    let xcheckUsd = 0;
    const mkCc = (model: string) => createOpenAiAnswerCrosscheck(createOpenAiProviderAdapter({ apiKey: process.env.OPENAI_API_KEY!, model, capability: 'advanced_verification' as AiCapability, compliance: COMPLIANCE }));
    const meter = (inner: ReturnType<typeof mkCc>) => ({
      name: inner.name,
      async crosscheck(req: Parameters<typeof inner.crosscheck>[0]) {
        if (xcheckUsd > XCHECK_CAP) return { verdict: 'UNCERTAIN' as const, confidence: 0, detail: 'D7 xcheck cap' };
        const out = await inner.crosscheck(req);
        if (out.usage && pricing.has(out.usage.model)) xcheckUsd += tokenCostUsd(pricing.priceAt(out.usage.model, new Date()), { inputTokens: out.usage.inputTokens, outputTokens: out.usage.outputTokens });
        return out;
      },
    });
    const crosscheckAdapter = createRoutedAnswerCrosscheck({
      base: meter(mkCc(process.env.CROSSCHECK_MODEL ?? 'gpt-4.1-mini')),
      geometryProof: meter(mkCc(process.env.CROSSCHECK_GEOMETRY_MODEL ?? 'gpt-5-mini')),
    });

    const store = new PgWorksheetGenerationStore(pool);
    const reviewQueue = new PgReviewQueueStore(pool);
    const queue = new PgWorksheetJobQueue(pool);
    const events: AiUsageEvent[] = [];
    // per-worksheet ceiling: 0.08 gives safe-substitute headroom, but never above
    // half the day cap or a tiny GEN_CAP could never enqueue a single worksheet.
    const guard = new DailyCostGuard({ perWorksheetUsd: Math.min(0.08, GEN_CAP / 2), perDayUsd: GEN_CAP });

    const worker = new WorksheetJobWorker({
      pool, workerId: 'd7', knowledgeBase: kb, referenceLibrary: lib, leaseMs: 300_000, backoffMs: 500,
      buildDeps: () => ({ generators, crosscheckAdapter, reviewQueue, store, usageSink: (e) => { events.push(e); void insertAiUsageEvent(pool, e).catch(() => undefined); }, costGuard: guard }),
    });

    let enqueued = 0;
    const crefAxis = new Map<string, Axis>();
    for (let i = 0; i < RUNS; i += 1) {
      if (!guard.canRun().ok) break;
      const axis = axes[i % axes.length]!;
      const spec = specForAxis(axis, `d7-${RUN_TAG}-${i}`);
      const cref = createHash('sha256').update(`${spec.childId}-${RUN_TAG}-${i}`).digest('hex').slice(0, 16);
      childRefs.push(cref);
      crefAxis.set(cref, axis);
      const id = await queue.enqueueDurable({ mode: 'SHADOW', spec, childRef: cref, usageContext: { userRef: 'u_d7', childRef: cref, plan: 'plus' as const } });
      if (id) enqueued += 1;
    }
    expect(enqueued).toBeGreaterThan(0);
    await worker.runToIdle(RUNS * 8 + 20);

    // ---- score against the exit gates ----
    const runs = await pool.query<{ id: string; worksheet_state: string; worksheet_latency_ms: number; actual_cost_usd: string }>(
      `SELECT id, worksheet_state, worksheet_latency_ms, actual_cost_usd FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])`,
      [childRefs],
    );
    const runIds = runs.rows.map((r) => r.id);
    const slots = await pool.query<{
      item_id: string; run_id: string; final_state: string; answer_status: string | null;
      production_ready: boolean; kernel_family: string | null; last_resort_used: boolean;
      crosscheck_required: boolean; crosscheck_verdict: string | null; review_queue_id: string | null;
      slot_latency_ms: number; criticality: string; substituted: boolean; omitted: boolean; degrade_reason: string | null;
    }>(
      `SELECT item_id, run_id, final_state, answer_status, production_ready, kernel_family,
              last_resort_used, crosscheck_required, crosscheck_verdict, review_queue_id, slot_latency_ms,
              criticality, substituted, omitted, degrade_reason
         FROM worksheet_slots WHERE run_id = ANY($1::text[])`,
      [runIds],
    );
    const attemptRows = await pool.query<{ run_id: string; item_id: string; attempt: number; model: string; step: string; accepted: boolean }>(
      `SELECT run_id, item_id, attempt, model, step, accepted FROM worksheet_slot_attempts WHERE run_id = ANY($1::text[]) ORDER BY attempt`,
      [runIds],
    );
    const delivered = slots.rows.filter((s) => s.final_state === 'READY'); // only READY reaches the child
    const kernelSlots = slots.rows.filter((s) => s.kernel_family);
    const kernelReady = kernelSlots.filter((s) => s.final_state === 'READY');
    const kernelProdReady = kernelReady.filter((s) => s.production_ready);
    const wrongAccepted = delivered.filter((s) => s.answer_status === 'DETERMINISTIC_WRONG');
    const semUnknownAccepted = delivered.filter((s) => s.answer_status === 'SEMANTIC_UNKNOWN');
    // a delivered item is VERIFIED iff a deterministic check or a Group-C PASS backs it
    const verifiedDelivered = delivered.filter((s) => s.answer_status === 'DETERMINISTIC_CORRECT' || s.crosscheck_verdict === 'PASS');
    const unsafeDelivered = delivered.filter((s) => !(s.answer_status === 'DETERMINISTIC_CORRECT' || s.crosscheck_verdict === 'PASS'));
    const coreSlotRows = slots.rows.filter((s) => s.criticality === 'REQUIRED_CORE');
    const optionalSlotRows = slots.rows.filter((s) => s.criticality !== 'REQUIRED_CORE');
    const coreDelivered = runs.rows.filter((r) => r.worksheet_state !== 'FAILED').length; // 100% REQUIRED_CORE READY
    const substitutedRows = slots.rows.filter((s) => s.substituted);
    const omittedRows = slots.rows.filter((s) => s.omitted || s.final_state === 'OMITTED');
    const reviewRows = slots.rows.filter((s) => s.review_queue_id);
    const wsWithOptional = new Set(optionalSlotRows.map((s) => s.run_id)).size;
    const attempts = await pool.query<{ mx: string }>(`SELECT max(cnt) mx FROM (SELECT count(*) cnt FROM worksheet_slot_attempts WHERE run_id = ANY($1::text[]) GROUP BY run_id, item_id) x`, [runIds]);
    const jobStats = await queue.stats();
    const dupRuns = await pool.query<{ mx: string }>(
      `SELECT coalesce(max(c),0) mx FROM (SELECT count(*) c FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[]) GROUP BY generation_spec_id) x`,
      [childRefs],
    );

    // ---- FAILURE DIAGNOSTICS (before afterAll purges staging) ----
    const wsStateDist: Record<string, number> = {};
    const runAxis = new Map<string, Axis>();
    for (const r of runs.rows) wsStateDist[r.worksheet_state] = (wsStateDist[r.worksheet_state] ?? 0) + 1;
    const runChildRef = await pool.query<{ id: string; child_ref: string }>(
      `SELECT id, child_ref FROM worksheet_generation_runs WHERE child_ref = ANY($1::text[])`, [childRefs]);
    for (const r of runChildRef.rows) { const ax = crefAxis.get(r.child_ref); if (ax) runAxis.set(r.id, ax); }
    const failDetail = await pool.query<{
      run_id: string; item_id: string; kernel_family: string | null; initial_role: string;
      route_reason: string; content_quality_codes: string[]; final_state: string;
    }>(
      `SELECT run_id, item_id, kernel_family, initial_role, route_reason, content_quality_codes, final_state
         FROM worksheet_slots WHERE run_id = ANY($1::text[]) AND final_state = 'FAILED'`, [runIds]);
    const degradeDetail = await pool.query<{ run_id: string; item_id: string; criticality: string; substituted: boolean; omitted: boolean; degrade_reason: string | null }>(
      `SELECT run_id, item_id, criticality, substituted, omitted, degrade_reason
         FROM worksheet_slots WHERE run_id = ANY($1::text[]) AND (substituted OR omitted OR degrade_reason IS NOT NULL)`, [runIds]);
    const degradeReasonLines = degradeDetail.rows.map((d) => {
      const ax = runAxis.get(d.run_id) ?? '?';
      const kind = d.substituted ? 'SUBSTITUTED' : d.omitted ? 'OMITTED' : 'DEGRADED';
      return `  ${ax} ${d.item_id.slice(-7)} ${kind} [${d.criticality}] ${d.degrade_reason ?? ''}`;
    });
    const failAttempts = await pool.query<{ run_id: string; item_id: string; failure_category: string | null; retry_reason: string | null; step: string; model: string }>(
      `SELECT run_id, item_id, failure_category, retry_reason, step, model
         FROM worksheet_slot_attempts WHERE run_id = ANY($1::text[]) AND accepted = false ORDER BY attempt`, [runIds]);
    const failByAxis: Record<string, number> = {};
    const failByRole: Record<string, number> = {};
    const failByFamily: Record<string, number> = {};
    for (const f of failDetail.rows) {
      const ax = runAxis.get(f.run_id) ?? 'unknown';
      failByAxis[ax] = (failByAxis[ax] ?? 0) + 1;
      failByRole[f.initial_role] = (failByRole[f.initial_role] ?? 0) + 1;
      failByFamily[f.kernel_family ?? 'NO_KERNEL'] = (failByFamily[f.kernel_family ?? 'NO_KERNEL'] ?? 0) + 1;
    }
    const failCatDist: Record<string, number> = {};
    const failReasonDist: Record<string, number> = {};
    const failKeys = new Set(failDetail.rows.map((f) => `${f.run_id}:${f.item_id}`));
    for (const a of failAttempts.rows) {
      if (!failKeys.has(`${a.run_id}:${a.item_id}`)) continue;
      failCatDist[a.failure_category ?? 'null'] = (failCatDist[a.failure_category ?? 'null'] ?? 0) + 1;
      failReasonDist[a.retry_reason ?? 'null'] = (failReasonDist[a.retry_reason ?? 'null'] ?? 0) + 1;
    }
    const cqOnFailed: Record<string, number> = {};
    for (const f of failDetail.rows) for (const c of f.content_quality_codes ?? []) cqOnFailed[c] = (cqOnFailed[c] ?? 0) + 1;
    const perAxisTotal: Record<string, number> = {};
    for (const s of slots.rows) { const ax = runAxis.get(s.run_id) ?? 'unknown'; perAxisTotal[ax] = (perAxisTotal[ax] ?? 0) + 1; }

    // ---- recovery-path classification (per slot) ----
    const attemptsBySlot = new Map<string, { attempt: number; model: string; step: string; accepted: boolean }[]>();
    for (const a of attemptRows.rows) {
      const k = `${a.run_id}:${a.item_id}`;
      let list = attemptsBySlot.get(k);
      if (!list) { list = []; attemptsBySlot.set(k, list); }
      list.push(a);
    }
    type Path = 'READY_FIRST_PASS' | 'READY_AFTER_RETRY' | 'READY_AFTER_FALLBACK' | 'READY_AFTER_LAST_RESORT' | 'READY_AFTER_CROSSCHECK' | 'READY_AFTER_SAFE_SUBSTITUTION' | 'OPTIONAL_OMITTED' | 'REVIEW_REQUIRED' | 'FAILED';
    const pathCount: Record<Path, number> = {
      READY_FIRST_PASS: 0, READY_AFTER_RETRY: 0, READY_AFTER_FALLBACK: 0, READY_AFTER_LAST_RESORT: 0,
      READY_AFTER_CROSSCHECK: 0, READY_AFTER_SAFE_SUBSTITUTION: 0, OPTIONAL_OMITTED: 0, REVIEW_REQUIRED: 0, FAILED: 0,
    };
    for (const s of slots.rows) {
      const at = (attemptsBySlot.get(`${s.run_id}:${s.item_id}`) ?? []).slice().sort((x, y) => x.attempt - y.attempt);
      let p: Path;
      if (s.final_state === 'FAILED') p = 'FAILED';
      else if (s.final_state === 'OMITTED') p = 'OPTIONAL_OMITTED';
      else if (s.substituted) p = 'READY_AFTER_SAFE_SUBSTITUTION';
      else if (s.last_resort_used || at.some((a) => a.step === 'last_resort' && a.accepted)) p = 'READY_AFTER_LAST_RESORT';
      else if (s.crosscheck_required && s.crosscheck_verdict === 'PASS') p = 'READY_AFTER_CROSSCHECK';
      else if (at.some((a) => a.step === 'escalate' && a.accepted)) p = 'READY_AFTER_FALLBACK';
      else if (at.some((a) => a.step === 'retry_same' && a.accepted) || at.length > 1) p = 'READY_AFTER_RETRY';
      else p = 'READY_FIRST_PASS';
      pathCount[p] += 1;
      if (s.review_queue_id) pathCount.REVIEW_REQUIRED += 1;
    }
    const totalSlots = slots.rows.length || 1;
    const pct = (n: number) => `${((n / totalSlots) * 100).toFixed(1)}%`;
    const avgAttempts = attemptRows.rows.length / totalSlots;

    // ---- model share ----
    const genAttempts = attemptRows.rows.filter((a) => a.model.startsWith('gpt-'));
    const m41 = genAttempts.filter((a) => a.model.includes('4.1-mini')).length;
    const m5 = genAttempts.filter((a) => a.model.includes('gpt-5-mini')).length;

    // ---- latency percentiles ----
    const pctl = (arr: number[], q: number) => {
      if (!arr.length) return 0;
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
    };
    const slotLat = slots.rows.map((s) => s.slot_latency_ms).filter((n) => n > 0);
    const wsLat = runs.rows.map((r) => r.worksheet_latency_ms).filter((n) => n > 0);
    const itemCount = slots.rows.length;

    const n = runs.rows.length || 1;
    const dlv = delivered.length || 1;
    const coreDeliveryRate = coreDelivered / n;
    const verifiedDeliveryRate = verifiedDelivered.length / dlv;
    const unsafeDeliveryRate = unsafeDelivered.length / dlv;
    const maxAtt = Number(attempts.rows[0]?.mx ?? 0);

    const report = [
      `DẠYZI — D7B FINAL CLEAN CONFIRMATION COHORT (staging)  ${new Date().toISOString()}  run=${RUN_TAG}`,
      `caps: generation $${GEN_CAP}  crosscheck $${XCHECK_CAP}`,
      ``,
      `== COUNTS ==`,
      `worksheets enqueued/done/failed: ${enqueued} / ${jobStats.DONE} / ${jobStats.FAILED}`,
      `persisted runs: ${runs.rows.length}   items (slots): ${itemCount}   delivered items: ${delivered.length}`,
      `REQUIRED_CORE slots: ${coreSlotRows.length}   OPTIONAL slots: ${optionalSlotRows.length}`,
      ``,
      `== HARD SAFETY GATES (doc 68 §13) ==`,
      `CORE_WORKSHEET_DELIVERY_RATE: ${(coreDeliveryRate * 100).toFixed(1)}%  (${coreDelivered}/${runs.rows.length})   gate ≥ 99%`,
      `VERIFIED_DELIVERY_RATE:       ${(verifiedDeliveryRate * 100).toFixed(2)}%  (${verifiedDelivered.length}/${delivered.length})   gate = 100%`,
      `UNSAFE_DELIVERY_RATE:         ${(unsafeDeliveryRate * 100).toFixed(2)}%  (${unsafeDelivered.length})   gate = 0%`,
      `kernel deterministic correctness: ${kernelReady.length ? ((kernelProdReady.length / kernelReady.length) * 100).toFixed(1) : 'n/a'}%  (${kernelProdReady.length}/${kernelReady.length})   gate = 100%`,
      `kernel item accepted WRONG: ${wrongAccepted.length}   gate = 0`,
      `silent SEMANTIC_UNKNOWN accepted: ${semUnknownAccepted.length}   gate = 0`,
      `max attempts / slot: ${maxAtt}   gate ≤ 6 (unbounded retry = 0)`,
      `max runs per generation_spec_id: ${dupRuns.rows[0]?.mx ?? 0}   gate = 1 (no duplicate worksheet)`,
      ``,
      `== RECOVERY PATHS (per item) ==`,
      `READY_FIRST_PASS:              ${pathCount.READY_FIRST_PASS}  (${pct(pathCount.READY_FIRST_PASS)})`,
      `READY_AFTER_RETRY:            ${pathCount.READY_AFTER_RETRY}  (${pct(pathCount.READY_AFTER_RETRY)})`,
      `READY_AFTER_FALLBACK:         ${pathCount.READY_AFTER_FALLBACK}  (${pct(pathCount.READY_AFTER_FALLBACK)})`,
      `READY_AFTER_LAST_RESORT:      ${pathCount.READY_AFTER_LAST_RESORT}  (${pct(pathCount.READY_AFTER_LAST_RESORT)})`,
      `READY_AFTER_CROSSCHECK:       ${pathCount.READY_AFTER_CROSSCHECK}  (${pct(pathCount.READY_AFTER_CROSSCHECK)})`,
      `READY_AFTER_SAFE_SUBSTITUTION: ${pathCount.READY_AFTER_SAFE_SUBSTITUTION}  (${pct(pathCount.READY_AFTER_SAFE_SUBSTITUTION)})`,
      `OPTIONAL_OMITTED:             ${pathCount.OPTIONAL_OMITTED}  (${pct(pathCount.OPTIONAL_OMITTED)})`,
      `REVIEW_REQUIRED (rows):       ${pathCount.REVIEW_REQUIRED}  (${pct(pathCount.REVIEW_REQUIRED)})`,
      `FAILED:                       ${pathCount.FAILED}  (${pct(pathCount.FAILED)})`,
      `average attempts / item: ${avgAttempts.toFixed(2)}`,
      ``,
      `== OPTIONAL BEHAVIOR (doc 68 §14) ==`,
      `OPTIONAL_CHALLENGE_AVAILABILITY: ${((wsWithOptional / n) * 100).toFixed(1)}%  (${wsWithOptional}/${runs.rows.length} worksheets carry ≥1 optional item)`,
      `SAFE_SUBSTITUTION_RATE (overall): ${slots.rows.length ? ((substitutedRows.length / slots.rows.length) * 100).toFixed(1) : '0'}%  (${substitutedRows.length}/${slots.rows.length} slots)`,
      `SAFE_SUBSTITUTION_RATE (REQUIRED_CORE): ${coreSlotRows.length ? ((substitutedRows.length / coreSlotRows.length) * 100).toFixed(1) : '0'}%  (${substitutedRows.length}/${coreSlotRows.length} core slots)${substitutedRows.length / (coreSlotRows.length || 1) > 0.1 ? '  ⚠ HIGH — flag for product review (doc 68 §7)' : ''}`,
      `OPTIONAL_OMISSION_RATE: ${optionalSlotRows.length ? ((omittedRows.length / optionalSlotRows.length) * 100).toFixed(1) : '0'}%  (${omittedRows.length}/${optionalSlotRows.length} optional slots)`,
      `REVIEW_QUEUE_RATE: ${((reviewRows.length / (slots.rows.length || 1)) * 100).toFixed(1)}%  (${reviewRows.length}/${slots.rows.length} slots)`,
      `-- substituted items: original → substitute (K/T + structure), skill/objective preservation (doc 68 §7) --`,
      ...(substitutedRows.length
        ? degradeDetail.rows.filter((d) => d.substituted).map((d) => `  ${runAxis.get(d.run_id) ?? '?'} ${d.item_id.slice(-7)} :: ${d.degrade_reason ?? '?'}`)
        : ['  (none)']),
      `-- exact reason per omitted / substituted item --`,
      ...(degradeReasonLines.length ? degradeReasonLines : ['  (none)']),
      ``,
      `== COST ==`,
      `generation spend: $${guard.spentTodayUsd.toFixed(4)} / $${GEN_CAP}`,
      `crosscheck spend: $${xcheckUsd.toFixed(4)} / $${XCHECK_CAP}`,
      `cost / item: $${(guard.spentTodayUsd / itemCount).toFixed(5)}   cost / delivered worksheet: $${(guard.spentTodayUsd / (coreDelivered || 1)).toFixed(5)}`,
      ``,
      `== MODEL SHARE (generation attempts) ==`,
      `gpt-4.1-mini: ${m41}  (${genAttempts.length ? ((m41 / genAttempts.length) * 100).toFixed(1) : '0'}%)`,
      `gpt-5-mini:   ${m5}  (${genAttempts.length ? ((m5 / genAttempts.length) * 100).toFixed(1) : '0'}%)`,
      ``,
      `== LATENCY ==`,
      `slot  p50/p95: ${pctl(slotLat, 0.5)}ms / ${pctl(slotLat, 0.95)}ms`,
      `sheet p50/p95: ${pctl(wsLat, 0.5)}ms / ${pctl(wsLat, 0.95)}ms`,
      ``,
      `== QUEUE / PERSISTENCE ==`,
      `job stats: ${JSON.stringify(jobStats)}`,
      `worksheet_state distribution: ${JSON.stringify(wsStateDist)}`,
      ``,
      `== FAILED-SLOT DIAGNOSTICS (if any) ==`,
      `FAILED slots by axis: ${JSON.stringify(failByAxis)}`,
      `slots per axis (total): ${JSON.stringify(perAxisTotal)}`,
      `FAILED slots by kernel_family: ${JSON.stringify(failByFamily)}`,
      `failure_category on failed slots' attempts: ${JSON.stringify(failCatDist)}`,
      `content_quality codes on FAILED slots: ${JSON.stringify(cqOnFailed)}`,
    ].join('\n');
    writeFileSync(OUT, report);
    console.log('\n' + report + '\n');

    // hard exit gates (doc 68 §13 + final directive §4/§5)
    expect(wrongAccepted.length, 'wrong answer accepted').toBe(0);
    expect(semUnknownAccepted.length, 'silent semantic contradiction').toBe(0);
    expect(unsafeDelivered.length, 'UNSAFE_DELIVERY_RATE must be 0').toBe(0);
    expect(verifiedDeliveryRate, 'VERIFIED_DELIVERY_RATE must be 100%').toBe(1);
    if (kernelReady.length > 0) expect(kernelProdReady.length).toBe(kernelReady.length);
    expect(maxAtt, 'bounded retry').toBeLessThanOrEqual(6);
    expect(Number(dupRuns.rows[0]?.mx ?? 0), 'duplicate worksheet').toBeLessThanOrEqual(1);
    expect(guard.spentTodayUsd).toBeLessThanOrEqual(GEN_CAP + 0.08);
    expect(xcheckUsd).toBeLessThanOrEqual(XCHECK_CAP + 0.05);
    // §5 — 30/30: EVERY persisted worksheet must be core-delivered (no rounding),
    // and the cohort must actually be ~30 worksheets (the cost guard must not have
    // silently truncated the run).
    expect(coreDelivered, `CORE_WORKSHEET_DELIVERY must be ${runs.rows.length}/${runs.rows.length} — no rounding`).toBe(runs.rows.length);
    expect(runs.rows.length, 'cohort must be ~30 worksheets').toBeGreaterThanOrEqual(28);
  }, 60 * 60 * 1000);
});
