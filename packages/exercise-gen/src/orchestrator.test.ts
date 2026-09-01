import { describe, expect, it } from 'vitest';
import { asSkillId, type GeneratedExercise, type GeneratedExerciseBatch } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { generationOperationToUsageEvent } from './telemetry.js';
import { createMockExerciseGenerator } from './mock-generator.js';
import { buildGenerationGrounding } from './grounding.js';
import type { ExerciseGenerator, GenerationOutcome, GenerationRequest } from './generator.js';
import { orchestrateGeneration } from './orchestrator.js';
import { makeSpec } from './_spec-fixture.js';

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const spec = makeSpec();

/** A generator that plays a scripted list of outcomes, then repeats the last. */
function scripted(outcomes: GenerationOutcome[]): ExerciseGenerator {
  let i = 0;
  return {
    name: 'scripted',
    provider: 'mock',
    model: 'mock',
    modelVersion: null,
    generate: (_req: GenerationRequest) => Promise.resolve(outcomes[Math.min(i++, outcomes.length - 1)]!),
  };
}

const okBatch = (items: GeneratedExercise[]): GenerationOutcome => ({
  ok: true,
  latencyMs: 3,
  batch: { generationSpecId: spec.generationSpecId, generatedAt: '1970-01-01T00:00:00.000Z', items },
});

/** Full valid batch from the mock, for reuse in scripted tests. */
async function mockBatch(): Promise<GeneratedExerciseBatch> {
  const g = buildGenerationGrounding(spec, lib, kb);
  const r = await createMockExerciseGenerator().generate({ grounding: g });
  if (!r.ok) throw new Error('mock failed to produce a batch');
  return r.batch;
}

describe('ExerciseGenerationOrchestrator (doc 14 C4 §J)', () => {
  it('happy path — Mock generator → validated, deliverable batch, count === spec.totalQuestions', async () => {
    const res = await orchestrateGeneration({ spec, generator: createMockExerciseGenerator(), referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('delivered');
    if (res.status !== 'delivered') return;
    expect(res.validation.deliverable).toBe(true);
    expect(res.batch.items).toHaveLength(spec.generationPlan.totalQuestions);
    expect(res.validation.batchDisposition).toBe('DELIVER');
  });

  it('§9 — after regenerating missing slots, validated count === spec.totalQuestions', async () => {
    const full = await mockBatch();
    const short = full.items.slice(0, full.items.length - 2); // 2 slots missing
    const res = await orchestrateGeneration({
      spec,
      generator: scripted([okBatch(short), okBatch(full.items)]),
      referenceLibrary: lib,
      knowledgeBase: kb,
    });
    expect(res.status).toBe('delivered');
    if (res.status !== 'delivered') return;
    expect(res.batch.items).toHaveLength(spec.generationPlan.totalQuestions);
    expect(res.trace.repairAttempts).toBeGreaterThanOrEqual(1);
  });

  it('§10 — generator keeps failing → structured failure, bounded (no infinite retry)', async () => {
    const badItems = (await mockBatch()).items.map((it) => ({ ...it, skillId: asSkillId('M7.MADE.UP') }));
    const res = await orchestrateGeneration({
      spec,
      generator: scripted([okBatch(badItems)]), // always a contract violation → QUARANTINE
      referenceLibrary: lib,
      knowledgeBase: kb,
      config: { maxGenerationAttempts: 2, maxRepairAttempts: 2 },
    });
    expect(res.status).toBe('failed');
    if (res.status !== 'failed') return;
    expect(res.trace.generationAttempts).toBe(2); // exactly the configured max — no more
    expect(res.reason).toMatch(/quarantined/i);
    expect(res.lastValidation?.batchDisposition).toBe('QUARANTINE');
  });

  it('§10 — generator returns a structured inability → failure, no crash', async () => {
    const inability: GenerationOutcome = {
      ok: false,
      latencyMs: 1,
      inability: { reason: 'cannot_satisfy_constraints', detail: 'no problem types for the K range' },
    };
    const res = await orchestrateGeneration({ spec, generator: scripted([inability]), referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('failed');
    if (res.status !== 'failed') return;
    expect(res.lastInability?.reason).toBe('cannot_satisfy_constraints');
  });

  it('§14 — the final batch traces back: batch → generationSpecId → provenance', async () => {
    const res = await orchestrateGeneration({ spec, generator: createMockExerciseGenerator(), referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('delivered');
    if (res.status !== 'delivered') return;
    expect(res.batch.generationSpecId).toBe(spec.generationSpecId);
    for (const it of res.batch.items) expect(it.generationSpecId).toBe(spec.generationSpecId);
    expect(res.trace.generationSpecId).toBe(spec.generationSpecId);
    expect(res.trace.groundingHash).toMatch(/^[0-9a-f]{16}$/);
    // spec itself carries the KB provenance
    expect(spec.provenance.curriculumRevision).toBeTruthy();
    expect(spec.provenance.curriculumContentHash).toBeTruthy();
  });

  it('§L — an orchestration result maps to append-only rows that trace back to the spec', async () => {
    const { InMemoryGenerationStore, toGenerationRecords } = await import('./persistence.js');
    const res = await orchestrateGeneration({ spec, generator: createMockExerciseGenerator(), referenceLibrary: lib, knowledgeBase: kb });
    const { specRecord, setRecord } = toGenerationRecords(spec, res, { setId: 'ges_test', now: () => new Date('2027-01-25T10:00:00Z') });
    const store = new InMemoryGenerationStore();
    await store.putSpec(specRecord);
    await store.putExerciseSet(setRecord);
    const sets = await store.listExerciseSets(spec.generationSpecId);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.generationSpecId).toBe(spec.generationSpecId);
    expect(sets[0]!.groundingHash).toBe(res.trace.groundingHash);
    expect(specRecord.curriculumContentHash).toBe(spec.provenance.curriculumContentHash);
    // append-only: a second putSpec for the same id is rejected
    await expect(store.putSpec(specRecord)).rejects.toThrow(/append-only/);
    // a set with no stored spec is rejected (must trace back)
    await expect(store.putExerciseSet({ ...setRecord, generationSpecId: 'egs_orphan' })).rejects.toThrow(/trace back/);
  });

  it('§16 — mock generator logs a worksheet_batch_generation operation: provider mock, cost 0', async () => {
    const res = await orchestrateGeneration({ spec, generator: createMockExerciseGenerator(), referenceLibrary: lib, knowledgeBase: kb });
    if (res.status !== 'delivered') throw new Error('expected delivery');
    expect(res.trace.operations.length).toBeGreaterThanOrEqual(1);
    const op = res.trace.operations[0]!;
    expect(op.operationType).toBe('worksheet_batch_generation');
    expect(op.provider).toBe('mock');
    expect(op.estimatedCostUsd).toBe(0);
    expect(op.generationSpecId).toBe(spec.generationSpecId);

    // maps onto the AI cost ledger event without rewrite
    const event = generationOperationToUsageEvent(op, { plan: 'basic', userRef: 'u_ref', childRef: 'c_ref' });
    expect(event.operationType).toBe('worksheet_batch_generation');
    expect(event.provider).toBe('mock');
    expect(event.estimatedCostVnd).toBe(0);
    expect(event.generationSpecId).toBe(spec.generationSpecId);
  });

  it('the Mock generator does NOT bypass the validator (a mock item that violates the spec is still caught)', async () => {
    // shrink the K range so the mock's mid-range items fall outside it
    const tight = makeSpec({ difficulty: { kMin: 'K0', kMax: 'K0', tMin: 'T1', tMax: 'T1', stretchRatio: 0.1 } });
    const res = await orchestrateGeneration({ spec: tight, generator: createMockExerciseGenerator(), referenceLibrary: lib, knowledgeBase: kb });
    // either it fails, or every delivered item is genuinely inside the (tiny) range
    if (res.status === 'delivered') {
      for (const it of res.batch.items) {
        expect(it.knowledgeLevel).toBe('K0');
        expect(it.thinkingLevel).toBe('T1');
      }
    } else {
      expect(res.status).toBe('failed');
    }
  });
});
