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

  it('CHILD C — repeated homework ahead of the calendar yields a positive paceDelta hypothesis', () => {
    expect((c!.paceDeltaHypothesis as { value: number }).value).toBeGreaterThan(0);
    expect(c!.paceDelta).toBe(0); // hypothesis only — not applied
  });

  it('prints the report (visible with --reporter=verbose)', () => {
    for (const d of runB3Demo()) {
      console.info(`\n=== ${d.label} ===\n` + JSON.stringify(d, null, 2));
    }
    expect(true).toBe(true);
  });
});
