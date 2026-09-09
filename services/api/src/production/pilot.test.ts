import { describe, expect, it } from 'vitest';
import type { WorksheetResult } from '@copilot/exercise-gen';
import { shouldSampleQa } from './internal-live-serving.js';
import { FEEDBACK_VERDICTS, PILOT_CONSENT, pilotChildRef, pilotFamilyRef } from './pilot.js';

/** doc 70 — pure helpers (no DB). */

function fakeResult(over: Partial<WorksheetResult> & { perSlot?: unknown[] } = {}): WorksheetResult {
  const perSlot = over.perSlot ?? [
    { attempts: [{}], crosscheckVerdict: 'PASS', reviewQueueId: null, finalState: 'READY', criticality: 'REQUIRED_CORE' },
  ];
  return {
    substitutedSlots: over.substitutedSlots ?? 0,
    omittedSlots: over.omittedSlots ?? 0,
    trace: { perSlot },
  } as unknown as WorksheetResult;
}

describe('doc 70 — pilot pure helpers', () => {
  it('refs are stable 16-hex pseudonyms', () => {
    expect(pilotChildRef('child-abc')).toMatch(/^[0-9a-f]{16}$/);
    expect(pilotFamilyRef('fam-abc')).toBe(pilotFamilyRef('fam-abc'));
    expect(pilotChildRef('a')).not.toBe(pilotChildRef('b'));
  });

  it('consent constant is pinned to the pilot policy version + processor', () => {
    expect(PILOT_CONSENT.processor).toBe('openai');
    expect(PILOT_CONSENT.policyVersion).toBe('pilot-2026-09');
    expect(PILOT_CONSENT.purpose).toBe('ai_generated_learning_content_pilot');
  });

  it('feedback verdicts cover the doc-70 §5 taxonomy', () => {
    expect(FEEDBACK_VERDICTS).toEqual([
      'SUITABLE', 'TOO_EASY', 'TOO_HARD', 'WRONG_CURRENT_TOPIC', 'ALREADY_MASTERED', 'CONTENT_QUALITY_ISSUE', 'OTHER',
    ]);
  });

  it('shouldSampleQa is event-triggered on every degraded path', () => {
    expect(shouldSampleQa(fakeResult({ substitutedSlots: 1 }), 'r1', {}).reason).toBe('safe_substitution');
    expect(shouldSampleQa(fakeResult({ omittedSlots: 1 }), 'r1', {}).reason).toBe('optional_omission');
    expect(
      shouldSampleQa(fakeResult({ perSlot: [{ attempts: [{}], crosscheckVerdict: 'UNCERTAIN', reviewQueueId: null }] }), 'r1', {}).reason,
    ).toBe('crosscheck_uncertain');
    expect(
      shouldSampleQa(fakeResult({ perSlot: [{ attempts: [{}], crosscheckVerdict: 'PASS', reviewQueueId: 'rq1' }] }), 'r1', {}).reason,
    ).toBe('review_required');
    expect(
      shouldSampleQa(fakeResult({ perSlot: [{ attempts: [{}, {}, {}], crosscheckVerdict: 'PASS', reviewQueueId: null }] }), 'r1', {}).reason,
    ).toBe('high_retry');
  });

  it('shouldSampleQa base rate: pilot rate is deterministic per runId, 0 disables', () => {
    const clean = fakeResult();
    expect(shouldSampleQa(clean, 'quiet-run', { PILOT_QA_SAMPLE_RATE: '0' }).sample).toBe(false);
    // rate 1.0 always samples; rate 0.0 never
    expect(shouldSampleQa(clean, 'any-run', { PILOT_QA_SAMPLE_RATE: '1' }).sample).toBe(true);
  });

  it('shouldSampleQa falls back to internal 1-in-N when no pilot rate is set', () => {
    const clean = fakeResult();
    // INTERNAL_LIVE_QA_SAMPLE_ONE_IN default is 5 — result depends on runId hash but is deterministic
    const a = shouldSampleQa(clean, 'deterministic-run-id', {});
    const b = shouldSampleQa(clean, 'deterministic-run-id', {});
    expect(a).toEqual(b);
    expect(['internal_one_in_n', 'not_sampled']).toContain(a.reason);
  });
});
