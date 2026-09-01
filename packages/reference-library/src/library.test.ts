import { describe, expect, it } from 'vitest';
import { calibrationRangeFor, examplesForSkill, groundingExamplesFor, loadReferenceLibrary } from './library.js';

describe('reference library corpus', () => {
  it('validates every example and requires a full six-rung hint ladder', () => {
    const lib = loadReferenceLibrary();
    expect(lib.length).toBeGreaterThan(4);
    const ids = new Set<string>();
    for (const q of lib) {
      expect(q.hints).toHaveLength(6);
      for (const h of q.hints) expect(h.trim().length).toBeGreaterThan(0);
      expect(q.workedSolution.length).toBeGreaterThan(0);
      expect(['authored', 'ai_generated']).toContain(q.origin);
      expect(ids.has(q.id), `duplicate id ${q.id}`).toBe(false);
      ids.add(q.id);
    }
  });

  it('AI-drafted examples stay flagged for educator review (anh decision Q5)', () => {
    const drafts = loadReferenceLibrary().filter((q) => q.origin === 'ai_generated');
    for (const q of drafts) expect(q.id).toContain('.AI.');
    const skills = new Set(drafts.map((q) => q.skillId));
    expect(skills.size).toBeGreaterThanOrEqual(12);
    expect([...skills].some((s) => s.startsWith('M4.'))).toBe(true);
    expect([...skills].some((s) => s.startsWith('M7.'))).toBe(true);
  });
});

describe('grounding / calibration API (not delivery)', () => {
  it('groundingExamplesFor returns at most `limit` examples, all for the skill', () => {
    const skill = examplesForSkill('M4.FRAC.COMMON_DENOM').length > 0 ? 'M4.FRAC.COMMON_DENOM' : loadReferenceLibrary()[0]!.skillId;
    const out = groundingExamplesFor({ skillId: skill, limit: 2 });
    expect(out.length).toBeLessThanOrEqual(2);
    for (const q of out) expect(q.skillId).toBe(skill);
  });

  it('prefers the same problem type when one is given', () => {
    const withPt = loadReferenceLibrary().find((q) => q.problemTypeId);
    if (!withPt) return;
    const out = groundingExamplesFor({ skillId: withPt.skillId, problemTypeId: withPt.problemTypeId, limit: 1 });
    expect(out[0]?.problemTypeId).toBe(withPt.problemTypeId);
  });

  it('unknown skill → no grounding examples (never a fallback question)', () => {
    expect(groundingExamplesFor({ skillId: 'NOPE.NOPE.NOPE' })).toEqual([]);
  });

  it('calibrationRangeFor returns an ordered K/T span or null', () => {
    const r = calibrationRangeFor('M4.FRAC.COMMON_DENOM');
    if (r) {
      expect(r.kMin <= r.kMax).toBe(true);
      expect(r.tMin <= r.tMax).toBe(true);
    }
    expect(calibrationRangeFor('NOPE.NOPE.NOPE')).toBeNull();
  });

  it('is deterministic', () => {
    const q = groundingExamplesFor({ skillId: loadReferenceLibrary()[0]!.skillId });
    const q2 = groundingExamplesFor({ skillId: loadReferenceLibrary()[0]!.skillId });
    expect(q).toEqual(q2);
  });
});
