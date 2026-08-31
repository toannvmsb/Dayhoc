import { describe, expect, it } from 'vitest';
import { DataMinimizationError, minimizeForProvider } from './minimize.js';
import type { ProviderCompliance } from './provider.js';

const compliant: ProviderCompliance = {
  provider: 'google-vision',
  processingRegion: 'asia-southeast1',
  crossBorder: true,
  dataCategoriesAllowed: ['raw_schoolwork', 'learning_activity'],
  providerRetention: '0 days (no retention configured)',
  trainingAllowed: false,
  dpaStatus: 'signed',
};

describe('minimizeForProvider (Privacy Architecture §5)', () => {
  it('strips PII fields and replaces childId with an opaque ref', () => {
    const r = minimizeForProvider({
      payload: {
        childId: 'child_minh_anh',
        displayName: 'Nguyễn Minh Anh',
        schoolName: 'THCS Lê Quý Đôn',
        attempt: { skillId: 'M4.FRAC.COMMON_DENOM', correct: false },
      },
      categories: ['learning_activity'],
      provider: compliant,
      childId: 'child_minh_anh',
    });
    const p = r.payload as Record<string, unknown>;
    expect(p).not.toHaveProperty('childId');
    expect(p).not.toHaveProperty('displayName');
    expect(p).not.toHaveProperty('schoolName');
    expect(p.childRef).toBe(r.childRef);
    expect(r.childRef).toHaveLength(16);
    expect(r.strippedKeys.sort()).toEqual(['displayName', 'schoolName']);
    expect((p.attempt as Record<string, unknown>).skillId).toBe('M4.FRAC.COMMON_DENOM');
  });

  it('is deterministic — same child id + salt → same ref', () => {
    const mk = () =>
      minimizeForProvider({ payload: { childId: 'c1' }, categories: [], provider: compliant, childId: 'c1' }).childRef;
    expect(mk()).toBe(mk());
  });

  it('refuses when payload categories exceed the provider allowance', () => {
    expect(() =>
      minimizeForProvider({
        payload: { x: 1 },
        categories: ['derived_state'], // not in google-vision allowance
        provider: compliant,
        childId: 'c1',
      }),
    ).toThrow(DataMinimizationError);
  });

  it('refuses any provider whose trainingAllowed is true', () => {
    expect(() =>
      minimizeForProvider({
        payload: {},
        categories: ['learning_activity'],
        provider: { ...compliant, trainingAllowed: true },
        childId: 'c1',
      }),
    ).toThrow(/trainingAllowed=true/);
  });

  it('honours a task-specific PII allow-list', () => {
    const r = minimizeForProvider({
      payload: { childId: 'c1', displayName: 'Minh Anh' },
      categories: ['ai_insights'],
      provider: { ...compliant, dataCategoriesAllowed: ['ai_insights', 'profile_context'] },
      childId: 'c1',
      allowPii: ['displayName'],
    });
    expect((r.payload as Record<string, unknown>).displayName).toBe('Minh Anh');
  });
});
