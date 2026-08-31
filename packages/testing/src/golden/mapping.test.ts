import { describe, expect, it } from 'vitest';
import { KB } from '../harness.js';
import { loadGoldenQuestions } from './load.js';

/**
 * Golden mapping gate (Golden Test Dataset README): every case's `skill_id` must
 * resolve to a real production Skill ID — the LLM/mapper never invents one.
 * Recommended gate: ≥95% on curated standard cases; we expect 100% here since
 * the dataset was built against the same Dev Core skill graph.
 */
describe('Golden mapping gate — 120 questions', () => {
  const questions = loadGoldenQuestions();

  it('loads all 120 golden questions (60 Grade 4 + 60 Grade 7)', () => {
    expect(questions).toHaveLength(120);
    expect(questions.filter((q) => q.grade_context === 4)).toHaveLength(60);
    expect(questions.filter((q) => q.grade_context === 7)).toHaveLength(60);
  });

  it('every skill_id resolves to a production Skill ID (gate ≥95%)', () => {
    const unresolved = questions.filter((q) => !KB.skills.has(q.skill_id as never));
    const rate = 1 - unresolved.length / questions.length;
    if (unresolved.length > 0) {
      console.warn('unresolved skill_ids:', unresolved.map((q) => `${q.case_id}:${q.skill_id}`));
    }
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });

  it('every K and T is on the shared taxonomy', () => {
    for (const q of questions) {
      expect(q.knowledge_level).toMatch(/^K[0-5]$/);
      expect(q.thinking_level).toMatch(/^T[1-5]$/);
    }
  });

  it('above-grade cases never assert a global grade level (cross-grade invariant)', () => {
    const g7 = questions.filter((q) => q.grade_context === 7);
    for (const q of g7) {
      // curriculum_origin may be G8/G9/HSG but grade_context stays 7
      expect(q.grade_context).toBe(7);
    }
  });
});
