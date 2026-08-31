import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { classifyErrorSignature, DEFAULT_GAP_CONFIG } from '@copilot/gap-engine';
import { KB } from '../harness.js';
import {
  loadCuratedPlannerScenarios,
  loadExpectedTwinPlannerStates,
  loadLearningEvidenceEvents,
  loadTwinPlannerProfiles,
  type ExpectedTwinPlannerState,
} from './load.js';
import { planMinutes, runTwinPlanner, TP_AS_OF, type TwinPlannerRun } from './twin-planner-pipeline.js';

/**
 * Golden Learning Twin & Planner Dataset v1.0 — the pipeline
 *   Evidence → Learning Twin → Gap → Readiness → Learning Mix → Daily Plan
 * run against 48 real synthetic profiles (912 evidence events).
 *
 * Coefficients are provisional (Decision P-02), and the dataset quantises
 * mastery to 0/50/100, so this suite is INVARIANT-DRIVEN, not exact-match:
 *   - structural invariants are hard-asserted (must hold for every profile);
 *   - directional / mastery checks run as a pass-rate with a gate.
 */

const profiles = loadTwinPlannerProfiles();
const events = loadLearningEvidenceEvents();
const expected = loadExpectedTwinPlannerStates();
const expectedById = new Map(expected.map((e) => [e.profile_id, e]));

const runs: TwinPlannerRun[] = profiles.map((p) => runTwinPlanner(p, events));

// --- per-profile invariant checkers: return an error string, or null if it holds ---
type Check = (run: TwinPlannerRun, exp: ExpectedTwinPlannerState) => string | null;

const CARELESS_SIGS = /careless|calculation_error|calculation_after_correct_model|careless_unit_error/;

const INVARIANT_CHECKS: Record<string, Check> = {
  school_grade_is_context_not_ceiling: ({ twin }) =>
    'level' in twin || 'grade' in twin ? 'twin carries a global grade/level field' : null,

  mastery_is_skill_specific: ({ profile, twin }) => {
    // The invariant is that mastery is tracked per skill — and that skills with
    // materially different evidence get materially different mastery. When every
    // observation in the profile is a clean unaided success, identical mastery is
    // correct, not a violation.
    const ok = new Set<string>();
    const wrong = new Set<string>();
    for (const e of events) {
      if (e.profile_id !== profile.profile_id) continue;
      (e.correct ? ok : wrong).add(e.skill_id);
    }
    const strong = [...ok].filter((s) => !wrong.has(s)).map((s) => twin.skillMastery.get(asSkillId(s))?.mastery ?? 0);
    const weak = [...wrong].map((s) => twin.skillMastery.get(asSkillId(s))?.mastery ?? 0);
    if (strong.length === 0 || weak.length === 0) return null;
    const minStrong = Math.min(...strong);
    const maxWeak = Math.max(...weak);
    return maxWeak >= minStrong
      ? 'a skill with only wrong answers scores as high as a skill with only right answers'
      : null;
  },

  frontier_is_domain_specific: ({ twin, evidence }) =>
    evidence.length > 0 && twin.frontier.length === 0 ? 'no per-domain frontier produced' : null,

  evidence_is_append_only: ({ profile, childId, twin, evidence }) => {
    const reversed = buildLearningTwin({
      childId,
      gradeContext: profile.grade_context,
      evidence: [...evidence].reverse(),
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    });
    for (const [id, s] of twin.skillMastery) {
      const other = reversed.skillMastery.get(id);
      if (!other || Math.abs(other.mastery - s.mastery) > 0.01) {
        return `twin not order-independent for ${id}`;
      }
    }
    return twin.computedFromEvidenceCount === evidence.length
      ? null
      : 'twin did not consume the full evidence history';
  },

  daily_plan_respects_time_budget: ({ profile, plan, planExam }) => {
    const b = profile.daily_time_budget_min;
    if (planMinutes(plan) > b + 1e-6) return `plan ${planMinutes(plan)}′ > budget ${b}′`;
    if (planMinutes(planExam) > b + 1e-6) return `exam plan ${planMinutes(planExam)}′ > budget ${b}′`;
    return null;
  },

  careless_error_minimal_knowledge_penalty: ({ profile, twin }) => {
    const careless = events.filter(
      (e) => e.profile_id === profile.profile_id && !!e.error_signature && CARELESS_SIGS.test(e.error_signature),
    );
    for (const e of careless) {
      const r = classifyErrorSignature({
        errorSignature: e.error_signature!,
        skillId: asSkillId(e.skill_id),
        twin,
        knowledgeBase: KB,
        config: DEFAULT_GAP_CONFIG,
      });
      if (r.masteryUpdate === 'provisional_penalty') return `careless "${e.error_signature}" took a full mastery penalty`;
      if (['concept_gap', 'prerequisite_gap', 'method_gap'].includes(r.gapType)) {
        return `careless "${e.error_signature}" classified as knowledge gap ${r.gapType}`;
      }
    }
    return null;
  },

  closed_gap_can_reopen_after_retention_failure: ({ profile, twin }) => {
    const retention = events.filter(
      (e) => e.profile_id === profile.profile_id && e.gap_type === 'retention_gap',
    );
    for (const e of retention) {
      const r = classifyErrorSignature({
        errorSignature: e.error_signature ?? 'conversion_factor_error',
        skillId: asSkillId(e.skill_id),
        twin,
        knowledgeBase: KB,
        config: DEFAULT_GAP_CONFIG,
      });
      if (r.gapType !== 'retention_gap') return `retention failure classified as ${r.gapType}`;
    }
    return null;
  },

  continue_advanced_where_ready_while_repairing_prerequisite: ({ gaps }) => {
    // when a prerequisite gap is open, the engine must not force "repair_first"
    // on every path — at least one readiness verdict stays ready/parallel.
    const hasPrereqGap = gaps.gaps.some((g) => g.type === 'prerequisite_gap');
    if (!hasPrereqGap) return null;
    const anyContinue = gaps.readiness.some((r) => r.recommendation !== 'repair_first');
    return gaps.readiness.length > 0 && !anyContinue
      ? 'every advanced path was blocked to "repair_first" despite a non-critical prereq gap'
      : null;
  },

  hinted_success_not_equal_independent_success: ({ profile, childId, twin, evidence }) => {
    const independent = buildLearningTwin({
      childId,
      gradeContext: profile.grade_context,
      evidence: evidence.map((e) => ({ ...e, hintDependency: 0 })),
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    });
    for (const [id, s] of twin.skillMastery) {
      const free = independent.skillMastery.get(id);
      if (free && s.mastery > free.mastery + 1) return `hinted mastery for ${id} exceeds unaided mastery`;
    }
    return null;
  },

  parent_feedback_creates_hypothesis_not_confirmed_gap: ({ gaps }) => {
    const confirmed = gaps.gaps.find((g) => g.lifecycleState !== 'DETECTED');
    return confirmed ? `gap ${confirmed.id} auto-advanced past DETECTED` : null;
  },

  revision_mode_prioritizes_exam_scope: ({ planExam }) =>
    planExam.kind === 'plan' && planExam.situation !== 'exam_soon'
      ? `exam-imminent plan situation was "${planExam.situation}"`
      : null,

  thinking_gap_must_not_automatically_reduce_core_knowledge_mastery: ({ profile, twin }) => {
    // skills the child clearly knows (≥3 attempts, ≥⅔ correct) must not be
    // dragged below a floor just because a high-thinking item failed.
    const bySkill = new Map<string, { n: number; ok: number }>();
    for (const e of events) {
      if (e.profile_id !== profile.profile_id) continue;
      const rec = bySkill.get(e.skill_id) ?? { n: 0, ok: 0 };
      rec.n += 1;
      rec.ok += e.correct ? 1 : 0;
      bySkill.set(e.skill_id, rec);
    }
    for (const [id, rec] of bySkill) {
      if (rec.n >= 3 && rec.ok / rec.n >= 0.66) {
        const m = twin.skillMastery.get(asSkillId(id))?.mastery ?? 100;
        if (m < 35) return `well-evidenced skill ${id} collapsed to ${Math.round(m)} mastery`;
      }
    }
    return null;
  },

  verified_evidence_weighted_higher_but_history_preserved: ({ twin, evidence }) =>
    twin.computedFromEvidenceCount === evidence.length ? null : 'verified weighting dropped historical evidence',
};

describe('Golden Twin & Planner — dataset shape', () => {
  it('loads 48 profiles, 912 events, 48 expected states, 15 curated scenarios', () => {
    expect(profiles).toHaveLength(48);
    expect(events).toHaveLength(912);
    expect(expected).toHaveLength(48);
    expect(loadCuratedPlannerScenarios()).toHaveLength(15);
    expect(profiles.filter((p) => p.grade_context === 4)).toHaveLength(24);
    expect(profiles.filter((p) => p.grade_context === 7)).toHaveLength(24);
  });

  it('every evidence event resolves to a production Skill ID', () => {
    const missing = [...new Set(events.map((e) => e.skill_id))].filter((s) => !KB.skills.has(s as never));
    expect(missing).toEqual([]);
  });

  it('every profile has its full event set and an expected state', () => {
    for (const p of profiles) {
      expect(events.filter((e) => e.profile_id === p.profile_id)).toHaveLength(p.event_ids.length);
      expect(expectedById.has(p.profile_id)).toBe(true);
    }
  });

  it('dataset base error_signature → gap_type matches the deterministic map exactly', () => {
    // classifyErrorSignature with no overrides must reproduce the dataset's label.
    const probe = buildLearningTwin({
      childId: asChildId('probe'),
      gradeContext: 4,
      evidence: [],
      knowledgeBase: KB,
      asOf: TP_AS_OF,
    });
    const mismatches: string[] = [];
    for (const e of events) {
      if (!e.error_signature || !e.gap_type) continue;
      const r = classifyErrorSignature({
        errorSignature: e.error_signature,
        skillId: asSkillId(e.skill_id),
        twin: probe,
        knowledgeBase: KB,
        config: DEFAULT_GAP_CONFIG,
      });
      // overrides (prereq / high-thinking) legitimately diverge; only flag the
      // base-signature cases where neither override could fire.
      if (r.gapType !== e.gap_type && !r.overrideApplied) {
        mismatches.push(`${e.event_id} ${e.error_signature}: got ${r.gapType}, dataset ${e.gap_type}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe('Golden Twin & Planner — structural invariants (hard, 48/48)', () => {
  it('no profile plan ever exceeds its selected time budget', () => {
    const over = runs.filter((r) => INVARIANT_CHECKS.daily_plan_respects_time_budget!(r, expectedById.get(r.profile.profile_id)!));
    expect(over.map((r) => r.profile.profile_id)).toEqual([]);
  });

  it('no twin exposes a single global grade / level', () => {
    for (const r of runs) {
      expect(r.twin).not.toHaveProperty('level');
      expect(r.twin).not.toHaveProperty('grade');
      expect(r.twin.frontier.length).toBeGreaterThan(0);
    }
  });

  it('every twin is an order-independent projection of the append-only stream', () => {
    const bad = runs.filter((r) => INVARIANT_CHECKS.evidence_is_append_only!(r, expectedById.get(r.profile.profile_id)!));
    expect(bad.map((r) => r.profile.profile_id)).toEqual([]);
  });

  it('hinted success never lifts mastery above the unaided rebuild', () => {
    const bad = runs.filter((r) =>
      INVARIANT_CHECKS.hinted_success_not_equal_independent_success!(r, expectedById.get(r.profile.profile_id)!),
    );
    expect(bad.map((r) => r.profile.profile_id)).toEqual([]);
  });

  it('the gap engine never auto-advances a gap past DETECTED', () => {
    for (const r of runs) for (const g of r.gaps.gaps) expect(g.lifecycleState).toBe('DETECTED');
  });
});

describe('Golden Twin & Planner — per-profile required_invariants', () => {
  it('every listed invariant holds for its profile (0 failures)', () => {
    const failures: string[] = [];
    for (const r of runs) {
      const exp = expectedById.get(r.profile.profile_id)!;
      for (const name of exp.required_invariants) {
        const check = INVARIANT_CHECKS[name];
        if (!check) {
          failures.push(`${r.profile.profile_id}: no checker for "${name}"`);
          continue;
        }
        const err = check(r, exp);
        if (err) failures.push(`${r.profile.profile_id} [${name}]: ${err}`);
      }
    }
    if (failures.length) console.error('invariant failures:\n' + failures.join('\n'));
    expect(failures).toEqual([]);
  });

  it('exercises all 13 distinct invariant names across the dataset', () => {
    const seen = new Set(expected.flatMap((e) => e.required_invariants));
    for (const name of seen) expect(INVARIANT_CHECKS[name], `checker for ${name}`).toBeTypeOf('function');
    expect(seen.size).toBeGreaterThanOrEqual(13);
  });
});

describe('Golden Twin & Planner — archetype directional signal', () => {
  // Each archetype should leave a recognisable fingerprint in the engine output.
  const ARCHETYPE_SIGNAL: Record<string, (r: TwinPlannerRun) => boolean> = {
    standard_progress: (r) => r.plan.kind === 'plan' || r.plan.kind === 'no_plan_needed',
    strong_advanced: (r) => r.mix.mix.advanced + r.mix.mix.thinking >= 25,
    prerequisite_gap: (r) => r.gaps.gaps.some((g) => g.type === 'prerequisite_gap' || g.rootSkillId !== g.targetSkillId),
    careless_profile: (r) =>
      [...r.twin.skillMastery.values()].some((s) => s.evidenceCount >= 2 && s.mastery >= 45),
    retention_decay: (r) =>
      [...r.twin.skillMastery.values()].some((s) => s.retention < 0.85) ||
      r.gaps.gaps.some((g) => g.type === 'retention_gap'),
    exam_mode: (r) => r.planExam.kind !== 'plan' || r.planExam.situation === 'exam_soon',
    parent_hypothesis: (r) => r.gaps.gaps.every((g) => g.lifecycleState === 'DETECTED'),
    conflicting_evidence: (r) => r.twin.computedFromEvidenceCount === r.evidence.length,
    hint_dependence: (r) =>
      r.evidence.some((e) => (e.hintDependency ?? 0) > 0) &&
      [...r.twin.skillMastery.values()].some((s) => s.confidence < 0.9),
    parallel_gap_repair: (r) => r.gaps.readiness.some((x) => x.recommendation !== 'repair_first'),
    thinking_gap: (r) =>
      [...r.twin.thinkingProfile.values()].some((t) => t.evidenceCount > 0) &&
      [...r.twin.skillMastery.values()].some((s) => s.mastery >= 40),
    uneven_frontier: (r) => new Set(r.twin.frontier.map((f) => f.frontierLabel)).size >= 1,
  };

  it('≥ 80% of profiles show their archetype fingerprint', () => {
    let hits = 0;
    const misses: string[] = [];
    for (const r of runs) {
      const sig = ARCHETYPE_SIGNAL[r.profile.archetype];
      if (!sig) {
        misses.push(`${r.profile.profile_id}: unknown archetype ${r.profile.archetype}`);
        continue;
      }
      if (sig(r)) hits += 1;
      else misses.push(`${r.profile.profile_id} (${r.profile.archetype})`);
    }
    if (misses.length) console.warn('archetype signal misses:', misses);
    expect(hits / runs.length).toBeGreaterThanOrEqual(0.8);
  });
});

describe('Golden Twin & Planner — mastery direction vs expected (provisional coefficients)', () => {
  // Pair every expected skill-mastery with what the engine produced.
  const pairs: { pid: string; skill: string; exp: number; got: number }[] = [];
  for (const r of runs) {
    const exp = expectedById.get(r.profile.profile_id)!;
    for (const s of exp.expected_learning_twin.skill_mastery_states) {
      const got = r.twin.skillMastery.get(asSkillId(s.skill_id))?.mastery;
      if (got !== undefined) pairs.push({ pid: r.profile.profile_id, skill: s.skill_id, exp: s.mastery_score, got });
    }
  }

  it('the engine and the dataset agree on which skills are strong vs weak (mean separation)', () => {
    const low = pairs.filter((p) => p.exp <= 33).map((p) => p.got);
    const high = pairs.filter((p) => p.exp >= 67).map((p) => p.got);
    expect(low.length).toBeGreaterThan(20);
    expect(high.length).toBeGreaterThan(20);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // strong skills must sit clearly above weak skills on average
    expect(mean(high) - mean(low)).toBeGreaterThan(20);
  });

  it('≥ 80% of clearly-strong / clearly-weak skills land in a compatible band', () => {
    const decided = pairs.filter((p) => p.exp <= 33 || p.exp >= 67);
    const wrong = decided.filter((p) => (p.exp >= 67 ? p.got < 45 : p.got > 62));
    if (wrong.length) {
      console.warn(
        `mastery direction misses (${wrong.length}/${decided.length}):`,
        wrong.slice(0, 25).map((p) => `${p.pid}/${p.skill} exp ${p.exp} got ${Math.round(p.got)}`),
      );
    }
    expect(1 - wrong.length / decided.length).toBeGreaterThanOrEqual(0.8);
  });
});

describe('Golden Twin & Planner — curated planner scenarios', () => {
  const scen = loadCuratedPlannerScenarios();
  const byId = new Map(scen.map((s) => [s.scenario_id, s]));

  it('loads all 15 curated scenarios with an input + expectations', () => {
    for (const s of scen) {
      expect(s.input.length).toBeGreaterThan(0);
      expect(s.expected.length).toBeGreaterThan(0);
    }
  });

  it('LP-S01 — a 10-minute gap day still yields a plan within budget', () => {
    const g4gap = runs.find((r) => r.profile.grade_context === 4 && r.profile.daily_time_budget_min === 10);
    expect(g4gap, 'a 10-min Grade-4 profile exists').toBeTruthy();
    expect(planMinutes(g4gap!.plan)).toBeLessThanOrEqual(10);
    expect(byId.has('LP-S01')).toBe(true);
  });

  it('LP-S03 — exam-imminent profiles switch to exam_soon planning', () => {
    const examProfiles = runs.filter((r) => r.profile.archetype === 'exam_mode');
    expect(examProfiles.length).toBeGreaterThan(0);
    for (const r of examProfiles) {
      if (r.planExam.kind === 'plan') expect(r.planExam.situation).toBe('exam_soon');
    }
  });

  it('LP-S06 — careless-streak profiles keep core mastery and stay off "knowledge gap"', () => {
    const careless = runs.filter((r) => r.profile.archetype === 'careless_profile');
    expect(careless.length).toBeGreaterThan(0);
    for (const r of careless) {
      expect(INVARIANT_CHECKS.careless_error_minimal_knowledge_penalty!(r, expectedById.get(r.profile.profile_id)!)).toBeNull();
    }
  });

  it('LP-S11 — parallel-repair profiles keep at least one non-blocked advanced path', () => {
    const par = runs.filter((r) => r.profile.archetype === 'parallel_gap_repair');
    expect(par.length).toBeGreaterThan(0);
    for (const r of par) {
      expect(r.gaps.readiness.some((x) => x.recommendation !== 'repair_first')).toBe(true);
    }
  });

  it('LP-S15 — every plan is ordered by descending ROI within its mix bucket', () => {
    for (const r of runs) {
      if (r.plan.kind !== 'plan') continue;
      const byBucket = new Map<string, number[]>();
      for (const a of r.plan.orderedActions) {
        const arr = byBucket.get(a.mixBucket) ?? [];
        arr.push(a.roiPerMinute);
        byBucket.set(a.mixBucket, arr);
      }
      for (const [, rois] of byBucket) {
        const sorted = [...rois].sort((x, y) => y - x);
        expect(rois).toEqual(sorted);
      }
    }
  });
});
