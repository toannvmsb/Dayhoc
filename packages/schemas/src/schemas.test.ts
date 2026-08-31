import { describe, expect, it } from 'vitest';
import { validate } from './validate.js';
import { evidenceInputSchema } from './evidence.schema.js';
import { classificationSchemaV1 } from './ai-classification.schema.js';

describe('evidence boundary validation', () => {
  const base = {
    childId: 'child_1',
    source: 'app_practice',
    occurredAt: '2026-08-30T10:00:00Z',
    result: { correct: true },
    confidenceTier: 'B',
    provenance: 'manual',
  };

  it('accepts a well-formed evidence input', () => {
    const r = validate(evidenceInputSchema, base);
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown evidence source', () => {
    const r = validate(evidenceInputSchema, { ...base, source: 'telepathy' });
    expect(r.ok).toBe(false);
  });

  it('rejects a hint dependency outside 0..1', () => {
    const r = validate(evidenceInputSchema, { ...base, hintDependency: 5 });
    expect(r.ok).toBe(false);
  });
});

describe('AI classification contract', () => {
  it('rejects output missing the version tag (never trust unvalidated AI output)', () => {
    const r = validate(classificationSchemaV1, {
      candidate_skill_ids: ['M4.FRAC.EQUIVALENT'],
      knowledge_level: 'K2',
      thinking_level: 'T2',
      confidence: 0.7,
      explanation: 'x',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid classify.v1 payload and defaults safety_flags', () => {
    const r = validate(classificationSchemaV1, {
      schema_version: 'classify.v1',
      candidate_skill_ids: ['M4.FRAC.EQUIVALENT'],
      knowledge_level: 'K2',
      thinking_level: 'T5',
      confidence: 0.72,
      explanation: 'standard knowledge, high thinking demand',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.safety_flags).toEqual([]);
  });
});
