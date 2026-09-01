import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { selectLearningTargets } from './target-selector.js';

const kb = loadKnowledgeBase();
const asOf = new Date('2027-02-01T09:00:00Z');
let n = 0;

const LESSON = 'C.G7.6.21';
const CURRENT = 'M7.RATIO.EQUAL_CHAIN'; // origin 7, algebraic_thinking
const PREREQ = 'M7.RATIO.PROPORTION';
const ALG_G9 = 'M7.ALG.SYMMETRIC'; // origin 9, algebraic_thinking
const ALG_G8 = 'M7.ALG.FACTOR'; // origin 8, algebraic_thinking
const GEO_G7 = 'M7.GEO.PARALLEL_CRITERIA'; // origin 7, geometry

function ev(childId: string, skillId: string, daysAgo: number, correct: boolean, over: Partial<Evidence> = {}): Evidence {
  const at = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${++n}` as Evidence['id'],
    childId: asChildId(childId),
    source: 'app_practice',
    occurredAt: at,
    recordedAt: at,
    skillId: asSkillId(skillId),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
    ...over,
  };
}

function select(childId: string, evidence: Evidence[], parentGoal: 'kha_gioi' | 'hsg_thi_chuyen' | 'theo_sat_chuong_trinh' = 'kha_gioi') {
  const cid = asChildId(childId);
  const twin = buildLearningTwin({ childId: cid, gradeContext: 7, evidence, knowledgeBase: kb, asOf });
  const gaps = runGapEngine({ childId: cid, gradeContext: 7, twin, evidence, knowledgeBase: kb, parentGoal, asOf });
  const readiness = gaps.readiness.find((r) => r.targetSkillId === CURRENT)?.recommendation ?? 'ready';
  return {
    twin,
    targets: selectLearningTargets({
      resolvedLessonId: LESSON,
      activeSkillIds: [asSkillId(CURRENT)],
      gradeContext: 7,
      twin,
      gaps,
      knowledgeBase: kb,
      parentGoal,
      readiness,
    }),
  };
}

// strong above-grade ALGEBRA traction (frontier ≈ Grade 9)
const algFrontier = (id: string): Evidence[] => [
  ev(id, CURRENT, 20, true, { confidenceTier: 'A' }),
  ev(id, PREREQ, 22, true, { confidenceTier: 'A' }),
  ev(id, ALG_G9, 16, true, { confidenceTier: 'A' }),
  ev(id, ALG_G9, 8, true, { confidenceTier: 'A' }),
  ev(id, ALG_G8, 12, true, { confidenceTier: 'A' }),
];
// strong GEOMETRY at grade level only; algebra only at grade level
const geoOnly = (id: string): Evidence[] => [
  ev(id, CURRENT, 20, true, { confidenceTier: 'A' }),
  ev(id, GEO_G7, 16, true, { confidenceTier: 'A' }),
  ev(id, GEO_G7, 8, true, { confidenceTier: 'A' }),
];

describe('selectLearningTargets (doc 14 C4.1 §3/§4)', () => {
  it('§1 — same current lesson, different frontier → different frontier targets', () => {
    const alg = select('c_alg', algFrontier('c_alg'));
    const geo = select('c_geo', geoOnly('c_geo'));
    expect(alg.targets.current.map((t) => t.skillId)).toEqual(geo.targets.current.map((t) => t.skillId));
    expect(alg.targets.frontier.map((t) => t.skillId)).not.toEqual(geo.targets.frontier.map((t) => t.skillId));
  });

  it('§2 — Grade 7 + algebra frontier ≈ Grade 9 → a valid above-grade ALGEBRA frontier target', () => {
    const { targets } = select('c_a2', algFrontier('c_a2'), 'hsg_thi_chuyen');
    expect(targets.frontier.length).toBeGreaterThanOrEqual(1);
    for (const f of targets.frontier) {
      expect(kb.getSkill(f.skillId).curriculumOrigin).toBeGreaterThan(7);
      expect(kb.getSkill(f.skillId).domain).toBe('algebraic_thinking');
      expect(f.role).toBe('FRONTIER');
      expect(f.buckets).toEqual(['advanced']);
    }
  });

  it('§3 — Grade 7 geometry frontier Grade 7 → does NOT inherit an algebra Grade-9 frontier', () => {
    const { targets } = select('c_a3', geoOnly('c_a3'), 'hsg_thi_chuyen');
    expect(targets.frontier).toEqual([]);
  });

  it('§4 — small Grade-8 prereq gap + Grade-9 frontier → Parallel Gap Repair (both roles present)', () => {
    const evidence = [
      ...algFrontier('c_a4'),
      // a mild non-blocking weakness on a prerequisite
      ev('c_a4', PREREQ, 5, false, { reasoningQuality: 'weak' }),
    ];
    const { targets } = select('c_a4', evidence, 'hsg_thi_chuyen');
    expect(targets.prerequisiteRepair.length).toBeGreaterThanOrEqual(1);
    expect(targets.frontier.length).toBeGreaterThanOrEqual(1);
  });

  it('§5 — a BLOCKING prerequisite on the candidate frontier skill → candidate rejected', () => {
    // SYMMETRIC's prereq closure includes lower algebra; force a blocking gap there
    const closure = kb.prerequisiteClosure(ALG_G9);
    const blockOn = closure.find((c) => kb.getSkill(c).domain === 'algebraic_thinking') ?? closure[0]!;
    const evidence = [
      ...algFrontier('c_a5'),
      ev('c_a5', blockOn, 6, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('c_a5', blockOn, 3, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('c_a5', CURRENT, 4, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    ];
    const { targets } = select('c_a5', evidence, 'hsg_thi_chuyen');
    expect(targets.frontier.some((f) => kb.prerequisiteClosure(f.skillId).includes(blockOn))).toBe(false);
  });

  it('§6 — HSG goal WITHOUT any above-grade frontier evidence → no above-grade knowledge target', () => {
    const { targets } = select('c_a6', geoOnly('c_a6'), 'hsg_thi_chuyen');
    expect(targets.frontier).toEqual([]);
    for (const t of targets.all) expect(kb.getSkill(t.skillId).curriculumOrigin).toBeLessThanOrEqual(7);
  });

  it('§8 — low-confidence frontier → NO frontier knowledge target (conservative K)', () => {
    // only one shaky above-grade observation → low frontier confidence
    const evidence = [
      ev('c_a8', CURRENT, 20, true, { confidenceTier: 'A' }),
      ev('c_a8', ALG_G9, 15, true, { confidenceTier: 'C', reasoningQuality: 'weak' }),
    ];
    const { targets } = select('c_a8', evidence, 'hsg_thi_chuyen');
    expect(targets.frontier).toEqual([]);
  });
});
