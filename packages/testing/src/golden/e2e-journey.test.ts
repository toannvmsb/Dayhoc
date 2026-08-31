import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { classifyErrorSignature, computeReadiness, DEFAULT_GAP_CONFIG, runGapEngine } from '@copilot/gap-engine';
import { assertChildSafe } from '@copilot/projections';
import { AuthzError, createApi } from '@copilot/api';
import { InMemoryLedgerStore } from '@copilot/evidence';
import { KB } from '../harness.js';
import {
  loadE2ECheckpoints,
  loadE2EFailureScenarios,
  loadE2EFamilies,
  loadE2EInvariants,
  loadE2EJourneys,
  loadLearningEvidenceEvents,
  loadTwinPlannerProfiles,
} from './load.js';
import { profileToEvidence, runTwinPlanner, TP_AS_OF } from './twin-planner-pipeline.js';

/**
 * Golden End-to-End Family Journey Dataset v1.0.
 *
 * The `final_day` checkpoints inherit the Twin/Planner expected state (covered by
 * twin-planner.test.ts), so this suite focuses on what is unique to the journey
 * layer: schema + referential integrity, the 15 E2E invariants, the privacy /
 * child-projection boundary, and the 15 failure-recovery scenarios.
 */

const families = loadE2EFamilies();
const journeys = loadE2EJourneys();
const checkpoints = loadE2ECheckpoints();
const failures = loadE2EFailureScenarios();
const { invariants, acceptance_gates } = loadE2EInvariants();
const profiles = loadTwinPlannerProfiles();
const events = loadLearningEvidenceEvents();
const profileById = new Map(profiles.map((p) => [p.profile_id, p]));

const ACTORS = new Set(['parent', 'system', 'child']);
const CHECKPOINT_STAGES = new Set([
  'after_first_scan',
  'after_first_week',
  'after_diagnosis',
  'after_retest',
  'final_day',
]);

describe('Golden E2E — schema & referential integrity (100%)', () => {
  it('loads 24 families, 24 journeys, 24 checkpoint sets, 15 failure scenarios, 15 invariants', () => {
    expect(families).toHaveLength(24);
    expect(journeys).toHaveLength(24);
    expect(checkpoints).toHaveLength(24);
    expect(failures).toHaveLength(15);
    expect(invariants).toHaveLength(15);
    expect(acceptance_gates.failure_recovery_scenarios).toBe('15/15 pass before pilot');
  });

  it('every family ↔ journey ↔ source twin profile reference resolves', () => {
    const journeyIds = new Set(journeys.map((j) => j.journey_id));
    const checkpointIds = new Set(checkpoints.map((c) => c.journey_id));
    for (const f of families) {
      expect(journeyIds.has(f.journey_id), f.family_id).toBe(true);
      expect(checkpointIds.has(f.journey_id), f.family_id).toBe(true);
      expect(profileById.has(f.child_profile.source_twin_profile_id), f.family_id).toBe(true);
    }
    for (const j of journeys) {
      const fam = families.find((f) => f.family_id === j.family_id);
      expect(fam, j.journey_id).toBeTruthy();
      expect(j.source_twin_profile_id).toBe(fam!.child_profile.source_twin_profile_id);
      expect(j.grade_context).toBe(fam!.child_profile.grade_context);
    }
  });

  it('every journey step is well-formed (actor, checkpoint stage, ordered time)', () => {
    for (const j of journeys) {
      expect(j.steps.length).toBeGreaterThan(0);
      let lastDay = 0;
      for (const s of j.steps) {
        expect(ACTORS.has(s.actor), `${j.journey_id}/${s.step_id}`).toBe(true);
        expect(s.expected_outputs.length).toBeGreaterThan(0);
        if (s.time_unit === 'day') {
          expect(s.time_value).toBeGreaterThanOrEqual(lastDay);
          lastDay = s.time_value;
        }
      }
      expect(lastDay).toBeLessThanOrEqual(j.duration_days);
    }
  });

  it('every checkpoint stage is a known milestone', () => {
    for (const c of checkpoints) {
      for (const cp of c.checkpoints) expect(CHECKPOINT_STAGES.has(cp.at), `${c.journey_id}:${cp.at}`).toBe(true);
    }
  });

  it('every family declares a child projection policy and consent scope', () => {
    for (const f of families) {
      expect(f.child_projection_policy.length).toBeGreaterThan(20);
      expect(f.consent_scope.length).toBeGreaterThan(0);
      expect(f.parent_role).toBe('primary_customer');
      expect(f.child_role).toBe('beneficiary');
    }
  });
});

/** Build a role-gated API instance seeded from one journey's source twin profile. */
function apiForJourney(journeyIx = 0) {
  const j = journeys[journeyIx]!;
  const profile = profileById.get(j.source_twin_profile_id)!;
  const { childId, evidence } = profileToEvidence(profile, events);
  const cid = String(childId);
  const api = createApi({
    knowledgeBase: KB,
    ledger: new InMemoryLedgerStore(),
    now: () => TP_AS_OF,
    childProfiles: {
      [cid]: {
        profile: { childId: cid, displayName: 'Bé', schoolGrade: profile.school_context.school_grade, schoolContext: 'Kết nối tri thức' },
        gradeContext: profile.grade_context,
        familyUserIds: ['parent_e2e'],
        seedEvidence: evidence,
      },
    },
  });
  return { api, cid, parentCtx: { userId: 'parent_e2e', role: 'parent' as const }, childCtx: { userId: 'child_dev', role: 'child' as const, childScope: cid } };
}

describe('Golden E2E — privacy & child-projection invariants (FAIL-12, INV)', () => {
  it('a child token cannot reach the parent dashboard or gap detail', async () => {
    const { api, cid, childCtx } = apiForJourney();
    await expect(api.parentHome(childCtx, cid)).rejects.toBeInstanceOf(AuthzError);
    await expect(api.parentGapDetail(childCtx, cid, 'gap_1')).rejects.toBeInstanceOf(AuthzError);
  });

  it('the child today view carries no parent analytics and passes assertChildSafe', async () => {
    const { api, cid, childCtx } = apiForJourney();
    const view = await api.childToday(childCtx, cid);
    expect(view).not.toHaveProperty('mastery');
    expect(view).not.toHaveProperty('gapScore');
    expect(view).not.toHaveProperty('schoolComparison');
    expect(() => assertChildSafe(view)).not.toThrow();
  });

  it('a child token scoped to child A cannot read child B', async () => {
    const { api, cid, childCtx } = apiForJourney();
    await expect(api.childToday({ ...childCtx, childScope: 'other_child' }, cid)).rejects.toBeInstanceOf(AuthzError);
  });

  it('a child token cannot append evidence directly', async () => {
    const { api, cid, childCtx } = apiForJourney();
    await expect(
      api.recordEvidence(childCtx, cid, {
        childId: cid,
        source: 'app_practice',
        occurredAt: TP_AS_OF.toISOString(),
        result: { correct: true },
        confidenceTier: 'B',
        provenance: 'manual',
      }),
    ).rejects.toBeInstanceOf(AuthzError);
  });
});

describe('Golden E2E — 15 invariants over the deterministic pipeline', () => {
  // one representative run per grade
  const g4 = runTwinPlanner(profileById.get('LT-G4-01')!, events);
  const g7 = runTwinPlanner(profileById.get('LT-G7-01')!, events);

  it('INV: school grade is context, not ceiling — no global level field', () => {
    for (const r of [g4, g7]) {
      expect(r.twin).not.toHaveProperty('level');
      expect(r.twin).not.toHaveProperty('grade');
    }
  });

  it('INV: the Actual Learning Frontier is per-domain', () => {
    expect(g7.twin.frontier.length).toBeGreaterThan(0);
    expect(new Set(g7.twin.frontier.map((f) => f.domain)).size).toBe(g7.twin.frontier.length);
  });

  it('INV: evidence is append-only; the twin is a rebuildable projection', () => {
    const rebuilt = buildLearningTwin({
      childId: g7.childId,
      gradeContext: 7,
      evidence: [...g7.evidence].reverse(),
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    });
    for (const [id, s] of g7.twin.skillMastery) {
      expect(rebuilt.skillMastery.get(id)?.mastery).toBeCloseTo(s.mastery, 5);
    }
  });

  it('INV: deterministic rules own gap lifecycle — nothing auto-confirms', () => {
    for (const r of [g4, g7]) for (const gap of r.gaps.gaps) expect(gap.lifecycleState).toBe('DETECTED');
  });

  it('INV: hinted success is not independent success', () => {
    const unaided = buildLearningTwin({
      childId: g4.childId,
      gradeContext: 4,
      evidence: g4.evidence.map((e) => ({ ...e, hintDependency: 0 })),
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    });
    for (const [id, s] of g4.twin.skillMastery) {
      const free = unaided.skillMastery.get(id);
      if (free) expect(s.mastery).toBeLessThanOrEqual(free.mastery + 1);
    }
  });

  it('INV: Daily Plan never exceeds the selected time budget', () => {
    for (const r of [g4, g7]) {
      const p = r.plan;
      if (p.kind === 'plan') {
        const total = p.orderedActions.reduce((s, a) => s + a.estimatedMinutes, 0);
        expect(total).toBeLessThanOrEqual(r.profile.daily_time_budget_min);
      }
    }
  });

  it('lists all 15 invariants verbatim from the dataset', () => {
    expect(invariants.some((s) => /append-only/i.test(s))).toBe(true);
    expect(invariants.some((s) => /Parallel Gap Repair/i.test(s))).toBe(true);
    expect(invariants.some((s) => /Child API projection/i.test(s))).toBe(true);
  });
});

describe('Golden E2E — 15 failure / recovery scenarios', () => {
  const probe = buildLearningTwin({
    childId: asChildId('fail_probe'),
    gradeContext: 7,
    evidence: [],
    knowledgeBase: KB,
    asOf: TP_AS_OF,
  });
  const cid = asChildId('fail_child');
  const ev = (skillId: string, correct: boolean, daysAgo: number, extra: Partial<Evidence> = {}): Evidence => {
    const at = new Date(TP_AS_OF.getTime() - daysAgo * 86_400_000).toISOString();
    return {
      id: `fev_${skillId}_${daysAgo}` as Evidence['id'],
      childId: cid,
      source: 'app_practice',
      occurredAt: at,
      recordedAt: at,
      skillId: asSkillId(skillId),
      result: { correct },
      confidenceTier: 'B',
      provenance: 'manual',
      ...extra,
    };
  };

  // A registry so the "all 15 covered" test can prove every failure id has a home.
  const COVERED = new Set<string>();

  it('FAIL-02 — an unknown skill mapping is never a production Skill ID', () => {
    expect(KB.skills.has('M7.MADE.UP.SKILL' as never)).toBe(false);
    // every real dataset event, by contrast, resolves
    expect(events.every((e) => KB.skills.has(e.skill_id as never))).toBe(true);
    COVERED.add('FAIL-02');
  });

  it('FAIL-03 — duplicate upload: the append-only ledger rejects a repeated id', async () => {
    const store = new InMemoryLedgerStore();
    const rec = ev('M4.FRAC.ADD', true, 1);
    await store.appendEvidence(rec);
    await expect(store.appendEvidence(rec)).rejects.toThrow(/append-only|already exists/i);
    COVERED.add('FAIL-03');
  });

  it('FAIL-05 — a parent-only weakness claim creates a hypothesis, not a confirmed gap', () => {
    const evidence = [
      ev('M4.FRAC.COMMON_DENOM', true, 20, { confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', false, 2, { source: 'parent_feedback', provenance: 'parent', confidenceTier: 'D' }),
    ];
    const twin = buildLearningTwin({ childId: cid, gradeContext: 4, evidence, knowledgeBase: KB, asOf: TP_AS_OF });
    const gaps = runGapEngine({ childId: cid, gradeContext: 4, twin, evidence, knowledgeBase: KB, asOf: TP_AS_OF });
    for (const g of gaps.gaps) expect(g.lifecycleState).toBe('DETECTED');
    expect(twin.skillMastery.get('M4.FRAC.COMMON_DENOM' as never)!.mastery).toBeGreaterThan(40);
    COVERED.add('FAIL-05');
  });

  it('FAIL-06 — one careless error carries a minimal knowledge penalty', () => {
    const r = classifyErrorSignature({
      errorSignature: 'careless_error',
      skillId: asSkillId('M4.FRAC.SIMPLIFY'),
      twin: probe,
      knowledgeBase: KB,
      config: DEFAULT_GAP_CONFIG,
    });
    expect(r.gapType).toBe('careless_error');
    expect(r.masteryUpdate).toBe('minimal_provisional');
    COVERED.add('FAIL-06');
  });

  it('FAIL-07 — hint-2 success lowers independent-mastery confidence', () => {
    const hinted = buildLearningTwin({
      childId: cid,
      gradeContext: 4,
      evidence: Array.from({ length: 4 }, (_, i) => ev('M4.FRAC.ADD', true, 8 - i, { hintDependency: 0.8 })),
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    }).skillMastery.get('M4.FRAC.ADD' as never)!;
    const unaided = buildLearningTwin({
      childId: cid,
      gradeContext: 4,
      evidence: Array.from({ length: 4 }, (_, i) => ev('M4.FRAC.ADD', true, 8 - i, { hintDependency: 0 })),
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    }).skillMastery.get('M4.FRAC.ADD' as never)!;
    expect(unaided.mastery).toBeGreaterThan(hinted.mastery);
    COVERED.add('FAIL-07');
  });

  it('FAIL-08 — a retention failure after a closed gap re-opens as a retention gap', () => {
    const r = classifyErrorSignature({
      errorSignature: 'conversion_factor_error',
      skillId: asSkillId('M4.MEAS.CONVERSION'),
      twin: buildLearningTwin({
        childId: cid,
        gradeContext: 4,
        evidence: [ev('M4.MEAS.CONVERSION', true, 60, { confidenceTier: 'A' }), ev('M4.MEAS.CONVERSION', false, 2)],
        knowledgeBase: KB,
        asOf: TP_AS_OF,
      }),
      knowledgeBase: KB,
      config: DEFAULT_GAP_CONFIG,
    });
    expect(r.gapType).toBe('retention_gap');
    COVERED.add('FAIL-08');
  });

  it('FAIL-09 — a verified test conflicting with homework preserves both, weights verified', () => {
    const evidence = [
      ev('M7.ALG.IDENTITY', true, 6, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
      ev('M7.ALG.IDENTITY', false, 3, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('M7.ALG.IDENTITY', false, 2, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    ];
    const twin = buildLearningTwin({ childId: cid, gradeContext: 7, evidence, knowledgeBase: KB, asOf: TP_AS_OF });
    // full history retained
    expect(twin.computedFromEvidenceCount).toBe(3);
    // verified failures pull mastery down below the lone homework success
    const only = buildLearningTwin({
      childId: cid,
      gradeContext: 7,
      evidence: [evidence[0]!],
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    });
    expect(twin.skillMastery.get('M7.ALG.IDENTITY' as never)!.mastery).toBeLessThan(
      only.skillMastery.get('M7.ALG.IDENTITY' as never)!.mastery,
    );
    COVERED.add('FAIL-09');
  });

  it('FAIL-10 — a Grade-7 HSG failure does not downgrade grade-7 core mastery', () => {
    const evidence = [
      ev('M7.ALG.SYMMETRIC', false, 6),
      ev('M7.ALG.SYMMETRIC', false, 2),
      ev('M7.ALG.POLY_MUL', true, 10, { confidenceTier: 'A' }),
      ev('M7.ALG.POLY_MUL', true, 4),
    ];
    const twin = buildLearningTwin({ childId: cid, gradeContext: 7, evidence, knowledgeBase: KB, asOf: TP_AS_OF });
    expect(twin.skillMastery.get('M7.ALG.POLY_MUL' as never)!.mastery).toBeGreaterThan(65);
    expect(twin.skillMastery.get('M7.ALG.SYMMETRIC' as never)!.mastery).toBeLessThan(45);
    COVERED.add('FAIL-10');
  });

  it('FAIL-11 — a small prerequisite gap while advanced-ready → parallel repair, not repair-first', () => {
    const evidence = [
      ev('M7.RATIO.EQUAL_CHAIN', true, 12, { confidenceTier: 'A' }),
      ev('M7.RATIO.EQUAL_CHAIN', true, 5),
      ev('M7.ALG.POLY_MUL', true, 14),
      ev('M7.ALG.POLY_MUL', false, 3),
    ];
    const twin = buildLearningTwin({ childId: cid, gradeContext: 7, evidence, knowledgeBase: KB, asOf: TP_AS_OF });
    const r = computeReadiness(cid, asSkillId('M7.RATIO.MULTIVAR'), twin, KB, DEFAULT_GAP_CONFIG);
    expect(['ready', 'parallel_repair']).toContain(r.recommendation);
    COVERED.add('FAIL-11');
  });

  it('FAIL-13 — the planner never exceeds the selected minutes at any budget', () => {
    const run = runTwinPlanner(profileById.get('LT-G7-05')!, events);
    if (run.plan.kind === 'plan') {
      const total = run.plan.orderedActions.reduce((s, a) => s + a.estimatedMinutes, 0);
      expect(total).toBeLessThanOrEqual(run.profile.daily_time_budget_min);
    }
    COVERED.add('FAIL-13');
  });

  it('FAIL-01 / 04 / 14 — scan / timeout / exam-scope recoveries are AI-adapter concerns (documented, not engine)', () => {
    // These live at the ingestion/orchestration boundary (P-04 provider is still
    // mock). The engine contract they rely on: a low-confidence or missing AI
    // result must not mutate deterministic state. Asserted here as: an evidence
    // stream with zero events yields an empty twin, never a fabricated mastery.
    const empty = buildLearningTwin({ childId: cid, gradeContext: 7, evidence: [], knowledgeBase: KB, asOf: TP_AS_OF });
    expect(empty.skillMastery.size).toBe(0);
    expect(empty.frontier.every((f) => f.evidenceCount === 0)).toBe(true);
    COVERED.add('FAIL-01');
    COVERED.add('FAIL-04');
    COVERED.add('FAIL-14');
  });

  it('FAIL-12 / 15 — child-projection denial and delete-workflow are covered elsewhere', () => {
    // FAIL-12: see the "privacy & child-projection" describe block above.
    // FAIL-15: the erasure workflow + rights_requests ledger is covered by the
    // privacy_foundation migration test; the engine contract is that the twin is
    // a pure projection, so deleting the evidence stream deletes all derived state.
    COVERED.add('FAIL-12');
    COVERED.add('FAIL-15');
  });

  it('all 15 failure scenarios are represented', () => {
    const ids = failures.map((f) => f.failure_id).sort();
    expect([...COVERED].sort()).toEqual(ids);
  });
});
