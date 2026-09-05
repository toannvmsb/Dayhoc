import { describe, expect, it } from 'vitest';
import { MockDocumentVisionAdapter } from '@copilot/uploads';
import {
  mathExpressionSimilarity,
  runVisionBenchmark,
  scoreConfidenceCalibration,
  scoreCurriculumMapping,
  scoreMathExtraction,
  scoreProblemExtraction,
  scoreTextExtraction,
  textSimilarity,
  type VisionBenchmarkCase,
  type VisionBenchmarkExpected,
} from './vision-benchmark.js';
import type { DocumentExtraction } from '@copilot/domain';

function extraction(overrides: Partial<DocumentExtraction> & { items: DocumentExtraction['items'] }): DocumentExtraction {
  return { documentType: 'HOMEWORK', observedOn: null, teacherNote: null, overallConfidence: 0.8, ...overrides };
}

describe('P4 — vision benchmark: similarity primitives', () => {
  it('textSimilarity is 1 for identical strings, 0 for completely different ones', () => {
    expect(textSimilarity('3/4 + 1/2', '3/4 + 1/2')).toBe(1);
    expect(textSimilarity('abc', 'xyz')).toBeLessThan(0.5);
    expect(textSimilarity('abc', 'abd')).toBeGreaterThan(0.5);
  });

  it('mathExpressionSimilarity is whitespace-insensitive and null-aware', () => {
    expect(mathExpressionSimilarity('3/4+1/2', '3/4 + 1/2')).toBe(1);
    expect(mathExpressionSimilarity(null, null)).toBe(1);
    expect(mathExpressionSimilarity('3/4', null)).toBe(0);
  });
});

describe('P4 — vision benchmark: per-category metrics (pure, synthetic fixtures)', () => {
  const expected: VisionBenchmarkExpected = {
    documentType: 'HOMEWORK',
    problemCount: 2,
    // `prompt` is a single free-text field (see the module doc comment on the
    // known ExtractedItem schema gap) — for a case asserting a PERFECT score
    // on every metric, keep it identical to the bare math expression so text
    // extraction and math extraction agree on what "correct" looks like.
    itemTexts: ['3/4 + 1/2', '6/8'],
    itemMathExpressions: ['3/4+1/2', '6/8'],
    itemSkillIds: ['M4.FRAC.ADD', 'M4.FRAC.SIMPLIFY'],
  };

  it('scores a perfect extraction as 1.0 on every metric', () => {
    const actual = extraction({
      items: [
        { index: 0, prompt: '3/4 + 1/2', childAnswer: null, markedCorrect: null, problemTypeId: null, skillCandidates: [{ skillId: 'M4.FRAC.ADD', confidence: 0.9 }] },
        { index: 1, prompt: '6/8', childAnswer: null, markedCorrect: null, problemTypeId: null, skillCandidates: [{ skillId: 'M4.FRAC.SIMPLIFY', confidence: 0.9 }] },
      ],
    });
    const cases = [{ actual, expected }];
    expect(scoreProblemExtraction(cases).score).toBe(1);
    expect(scoreTextExtraction(cases).score).toBe(1);
    expect(scoreMathExtraction(cases).score).toBe(1);
    expect(scoreCurriculumMapping(cases).score).toBe(1);
  });

  it('penalizes a wrong problem count proportionally, not as a binary miss', () => {
    const actual = extraction({
      items: [{ index: 0, prompt: 'Tính 3/4 + 1/2', childAnswer: null, markedCorrect: null, problemTypeId: null, skillCandidates: [] }],
    });
    // found 1 of 2 expected problems -> 1 - |1-2|/2 = 0.5
    expect(scoreProblemExtraction([{ actual, expected }]).score).toBeCloseTo(0.5, 5);
  });

  it('curriculum mapping scores 0 for a wrong top skill candidate, ignores items with no expected mapping', () => {
    const noMappingExpected: VisionBenchmarkExpected = { ...expected, itemSkillIds: ['M4.FRAC.ADD', null] };
    const actual = extraction({
      items: [
        { index: 0, prompt: 'x', childAnswer: null, markedCorrect: null, problemTypeId: null, skillCandidates: [{ skillId: 'WRONG_SKILL', confidence: 0.9 }] },
        { index: 1, prompt: 'y', childAnswer: null, markedCorrect: null, problemTypeId: null, skillCandidates: [{ skillId: 'ANYTHING', confidence: 0.9 }] },
      ],
    });
    const r = scoreCurriculumMapping([{ actual, expected: noMappingExpected }]);
    expect(r.score).toBe(0); // the one scorable item was wrong
    expect(r.sampleCount).toBe(1); // the null-expected item was excluded, not scored as wrong
  });

  it('confidence calibration penalizes overconfidence even when the mapping itself is fine on average', () => {
    // Both items say confidence 0.95 but only one of two is actually correct
    // -> bucket 0.9-1.0 mean stated 0.95 vs realized 0.5 -> large calibration error.
    const actual = extraction({
      items: [
        { index: 0, prompt: 'x', childAnswer: null, markedCorrect: null, problemTypeId: null, skillCandidates: [{ skillId: 'M4.FRAC.ADD', confidence: 0.95 }] },
        { index: 1, prompt: 'y', childAnswer: null, markedCorrect: null, problemTypeId: null, skillCandidates: [{ skillId: 'WRONG', confidence: 0.95 }] },
      ],
    });
    const r = scoreConfidenceCalibration([{ actual, expected }]);
    expect(r.score).toBeLessThan(0.6); // poorly calibrated
  });
});

describe('P4 — vision benchmark: harness wiring smoke-test (NOT a benchmark result)', () => {
  it('runs end-to-end against MockDocumentVisionAdapter and skips a case with no local image', async () => {
    const cases: VisionBenchmarkCase[] = [
      {
        id: 'smoke-no-image',
        imagePath: '/does/not/exist.jpg',
        mimeType: 'image/jpeg',
        childGrade: 4,
        kindHint: 'HOMEWORK',
        knownSkillIds: ['M4.FRAC.ADD'],
        expected: { documentType: 'HOMEWORK', problemCount: 1, itemTexts: ['x'], itemMathExpressions: [null], itemSkillIds: [null] },
      },
    ];
    const report = await runVisionBenchmark({
      adapter: new MockDocumentVisionAdapter(),
      cases,
      readImageBytes: async () => null, // simulates "no real dataset present locally"
    });
    expect(report.ranCaseCount).toBe(0);
    expect(report.skippedMissingImage).toEqual(['smoke-no-image']);
  });

  it('exercises the mock adapter when bytes ARE available (proves the pipeline runs, not that accuracy is good)', async () => {
    const cases: VisionBenchmarkCase[] = [
      {
        id: 'smoke-with-bytes',
        imagePath: 'in-memory',
        mimeType: 'image/jpeg',
        childGrade: 4,
        kindHint: 'HOMEWORK',
        knownSkillIds: ['M4.FRAC.ADD'],
        expected: { documentType: 'HOMEWORK', problemCount: 4, itemTexts: [], itemMathExpressions: [], itemSkillIds: [] },
      },
    ];
    const report = await runVisionBenchmark({
      adapter: new MockDocumentVisionAdapter(),
      cases,
      readImageBytes: async () => new Uint8Array([1, 2, 3]),
    });
    expect(report.ranCaseCount).toBe(1);
    expect(report.perCase[0]?.itemCount).toBeGreaterThan(0);
  });
});
