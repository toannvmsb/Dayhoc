import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { classifyErrorSignature, DEFAULT_GAP_CONFIG } from '@copilot/gap-engine';
import { KB } from '../harness.js';
import { loadGoldenErrors } from './load.js';

/**
 * KNOWLEDGE GAP ENGINE — real data test (Golden Error Dataset, 360 cases).
 *
 * "phần khó nhất không phải biết đáp án đúng mà là biết vì sao con sai."
 *
 * The AI/scan layer proposes an `error_signature`; the deterministic
 * `classifyErrorSignature` maps it (with prerequisite state + thinking level) to
 * a gap type. This test checks that mapping against every case's
 * `expected_gap_type`. Recommended gate: ≥90% on curated diagnosis cases.
 */

const childId = asChildId('golden_error_child');
const asOf = new Date('2026-08-31T09:00:00Z');

/** A minimal twin where the case's skill is mid and its prereqs are healthy —
 *  so overrides only fire when the signature itself implies a prerequisite root. */
function twinFor(skillId: string) {
  const ev = (id: string, correct: boolean, days: number): Evidence => ({
    id: `ev_${id}_${days}` as Evidence['id'],
    childId,
    source: 'app_practice',
    occurredAt: new Date(asOf.getTime() - days * 86_400_000).toISOString(),
    recordedAt: new Date(asOf.getTime() - days * 86_400_000).toISOString(),
    skillId: asSkillId(id),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
  });
  const evidence = [ev(skillId, true, 12), ev(skillId, true, 6), ev(skillId, false, 2)];
  const gradeContext = skillId.startsWith('M7.') ? 7 : 4;
  return buildLearningTwin({ childId, gradeContext, evidence, knowledgeBase: KB, asOf });
}

describe('Golden Error Dataset — signature → gap type', () => {
  const errors = loadGoldenErrors();

  it('loads all 360 synthetic error cases', () => {
    expect(errors).toHaveLength(360);
  });

  it('classifies ≥90% of cases to the expected gap type', () => {
    const twinCache = new Map<string, ReturnType<typeof twinFor>>();
    let correct = 0;
    const misses: Record<string, number> = {};

    for (const e of errors) {
      if (!KB.skills.has(e.skill_id as never)) continue;
      let twin = twinCache.get(e.skill_id);
      if (!twin) {
        twin = twinFor(e.skill_id);
        twinCache.set(e.skill_id, twin);
      }
      const result = classifyErrorSignature({
        errorSignature: e.error_signature,
        skillId: asSkillId(e.skill_id),
        problemTypeId: e.problem_type,
        thinkingLevel: e.thinking_level,
        twin,
        knowledgeBase: KB,
        config: DEFAULT_GAP_CONFIG,
        corroboratingObservations: e.severity === 'high' ? 2 : e.severity === 'medium' ? 1 : 0,
        verifiedEvidence: e.severity === 'high',
      });
      if (result.gapType === e.expected_gap_type) correct += 1;
      else {
        const key = `${e.error_signature} → got ${result.gapType}, want ${e.expected_gap_type}`;
        misses[key] = (misses[key] ?? 0) + 1;
      }
    }

    const rate = correct / errors.length;
    console.log(`error-diagnosis: ${correct}/${errors.length} = ${(rate * 100).toFixed(1)}%`);
    if (rate < 0.95) {
      console.log('top misses:', Object.entries(misses).sort((a, b) => b[1] - a[1]).slice(0, 8));
    }
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it('non-negotiable: careless_error signatures never yield a knowledge gap', () => {
    const carelessCases = errors.filter((e) => e.expected_gap_type === 'careless_error');
    for (const e of carelessCases.slice(0, 20)) {
      const twin = twinFor(e.skill_id);
      const r = classifyErrorSignature({
        errorSignature: e.error_signature,
        skillId: asSkillId(e.skill_id),
        thinkingLevel: e.thinking_level,
        twin,
        knowledgeBase: KB,
        config: DEFAULT_GAP_CONFIG,
        corroboratingObservations: 0,
      });
      expect(['careless_error', 'presentation_error', 'prerequisite_gap']).toContain(r.gapType);
      if (r.gapType === 'careless_error') expect(r.masteryUpdate).toBe('minimal_provisional');
    }
  });

  it('non-negotiable: one uncorroborated observation is never high confidence', () => {
    const e = errors[0]!;
    const r = classifyErrorSignature({
      errorSignature: e.error_signature,
      skillId: asSkillId(e.skill_id),
      twin: twinFor(e.skill_id),
      knowledgeBase: KB,
      config: DEFAULT_GAP_CONFIG,
      corroboratingObservations: 0,
    });
    expect(r.confidence).toBe('low');
  });
});
