import { describe, expect, it } from 'vitest';
import { runB3Demo } from './b3-context-demo.js';

describe('B3 functional demo — 3 children (doc 17 §7)', () => {
  const [a, b, c] = runB3Demo();

  it('CHILD A — estimated context from the calendar, marked ESTIMATED', () => {
    expect(a!.resolved).toMatchObject({ source: 'CURRICULUM_TIMELINE', confidence: 'ESTIMATED' });
    expect(a!.expected).toMatchObject({ confidence: 'ESTIMATED' });
    // window, not a single lesson
    expect((a!.expected as { window: { lessonIds: string[] } }).window.lessonIds.length).toBeGreaterThan(1);
  });

  it('CHILD B — parent confirmation resolves the context; the calendar estimate is kept separately', () => {
    expect(b!.resolved).toMatchObject({ source: 'PARENT_UPDATE', lessonId: 'C.G4.8.5' });
    expect((b!.expected as { lessonId: string }).lessonId).not.toBe('C.G4.8.5'); // estimate is different + still there
  });

  it('CHILD C — 5 consistent homework scans over ≥2 weeks → LOW paceDelta auto-applied', () => {
    expect((c!.paceDeltaHypothesis as { value: number; spanWeeks: number }).value).toBeGreaterThan(0);
    expect((c!.paceDeltaHypothesis as { spanWeeks: number }).spanWeeks).toBeGreaterThanOrEqual(2);
    expect(c!.paceDelta).toBeGreaterThan(0); // auto-applied (LOW confidence)
    expect(Math.abs(c!.paceDelta)).toBeLessThanOrEqual(0.25);
  });

  it('CHILD C — CRITICAL: an auto-applied paceDelta never becomes VERIFIED actual context', () => {
    // pace only shifts the FUTURE estimate; the resolved lesson is still only as
    // strong as the evidence behind it (homework scans → SUPPORTING at best).
    const resolved = c!.resolved as { source: string; confidence: string };
    expect(resolved.confidence).not.toBe('VERIFIED');
    expect(resolved.source).not.toBe('TEACHER_UPDATE');
    expect(resolved.source).not.toBe('PARENT_UPDATE');
  });

  it('prints the report (visible with --reporter=verbose)', () => {
    for (const d of runB3Demo()) {
      console.info(`\n=== ${d.label} ===\n` + JSON.stringify(d, null, 2));
    }
    expect(true).toBe(true);
  });
});
