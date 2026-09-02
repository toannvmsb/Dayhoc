import { describe, expect, it } from 'vitest';
import {
  AnalyticsPrivacyError,
  ConsoleAnalyticsAdapter,
  NoopAnalyticsAdapter,
  safeAnalytics,
  sanitizeEvent,
} from './analytics.js';

const HASH = 'a1b2c3d4e5f6a7b8';

describe('M49 — privacy-safe analytics', () => {
  it('keeps category + action + numeric/enum metadata', () => {
    const ev = sanitizeEvent({
      category: 'practice',
      action: 'practice_submitted',
      actorRef: HASH,
      metadata: { items: 4, correct: 3, grade: 4, mode: 'legacy' },
    });
    expect(ev.category).toBe('practice');
    expect(ev.metadata).toEqual({ items: 4, correct: 3, grade: 4, mode: 'legacy' });
  });

  it('rejects a raw id as actorRef', () => {
    expect(() =>
      sanitizeEvent({ category: 'auth', action: 'login', actorRef: 'b31e0457-a27b-40d7-b05e-d038facf7efe' }),
    ).toThrow(AnalyticsPrivacyError);
  });

  it('rejects child name / school / question / answer / gap / evidence in metadata', () => {
    for (const bad of [
      { childName: 'Bé An' },
      { school: 'THCS Cầu Giấy' },
      { question: '2/3 + 1/6 = ?' },
      { answer: '5/6' },
      { gapRationale: 'con chưa quy đồng mẫu' },
      { evidenceText: 'bài kiểm tra 8 điểm' },
      { childId: HASH },
      { email: 'a@b.com' },
    ]) {
      expect(() =>
        sanitizeEvent({ category: 'practice', action: 'x', actorRef: HASH, metadata: bad as never }),
      ).toThrow(AnalyticsPrivacyError);
    }
  });

  it('rejects free-text-looking metadata strings', () => {
    expect(() =>
      sanitizeEvent({
        category: 'teaching_copilot',
        action: 'viewed',
        actorRef: HASH,
        metadata: { blurb: 'Con đang vướng ở quy đồng. Hãy giúp con.' } as never,
      }),
    ).toThrow(AnalyticsPrivacyError);
  });

  it('production mode drops offending keys instead of throwing', () => {
    const ev = sanitizeEvent(
      { category: 'upload', action: 'confirmed', actorRef: HASH, metadata: { count: 2, childName: 'x' } as never },
      { strict: false },
    );
    expect(ev.metadata).toEqual({ count: 2 });
  });

  it('safeAnalytics never throws even on a bad event', () => {
    const a = safeAnalytics(new ConsoleAnalyticsAdapter());
    expect(() => a.track({ category: 'auth', action: 'x', actorRef: 'raw-id', metadata: { email: 'a@b' } as never })).not.toThrow();
    expect(() => new NoopAnalyticsAdapter().track({ category: 'auth', action: 'x', actorRef: HASH })).not.toThrow();
  });
});
