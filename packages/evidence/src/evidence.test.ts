import { describe, expect, it, vi } from 'vitest';
import { EvidenceService, EvidenceValidationError } from './service.js';
import { InMemoryLedgerStore } from './store.js';

function makeService() {
  let n = 0;
  const store = new InMemoryLedgerStore();
  const service = new EvidenceService({
    store,
    now: () => new Date('2026-08-31T09:00:00Z'),
    newId: () => `id${++n}`,
  });
  return { store, service };
}

const child = 'child_minh_anh';

describe('EvidenceService — append-only ledger (Phase 2 acceptance)', () => {
  it('records evidence, stamping id + recordedAt + provenance', async () => {
    const { service } = makeService();
    const ev = await service.record({
      childId: child,
      source: 'app_practice',
      occurredAt: '2026-08-30T10:00:00Z',
      skillId: 'M4.FRAC.COMMON_DENOM',
      result: { correct: false },
      confidenceTier: 'B',
      provenance: 'parent',
    });
    expect(ev.id).toBe('ev_id1');
    expect(ev.recordedAt).toBe('2026-08-31T09:00:00.000Z');
    expect(ev.provenance).toBe('parent');
  });

  it('rejects invalid input at the boundary', async () => {
    const { service } = makeService();
    await expect(
      service.record({
        childId: child,
        source: 'nonsense',
        occurredAt: '2026-08-30T10:00:00Z',
        result: {},
        confidenceTier: 'B',
        provenance: 'parent',
      } as never),
    ).rejects.toBeInstanceOf(EvidenceValidationError);
  });

  it('exposes no way to update or delete a record', () => {
    const store = new InMemoryLedgerStore();
    expect('update' in store).toBe(false);
    expect('delete' in store).toBe(false);
    expect('appendEvidence' in store).toBe(true);
  });

  it('refuses to re-append the same id (ledger is immutable)', async () => {
    const store = new InMemoryLedgerStore();
    const rec = {
      id: 'ev_x',
      childId: child as never,
      source: 'diagnostic' as const,
      occurredAt: '2026-08-30T10:00:00Z',
      recordedAt: '2026-08-30T10:00:00Z',
      result: { correct: true },
      confidenceTier: 'A' as const,
      provenance: 'assessment' as const,
    };
    await store.appendEvidence(rec);
    await expect(store.appendEvidence(rec)).rejects.toThrow(/append-only/);
  });

  it('keeps parent, teacher, manual and assessment evidence side by side for one child', async () => {
    const { service } = makeService();
    for (const [source, provenance] of [
      ['parent_feedback', 'parent'],
      ['teacher_feedback', 'teacher'],
      ['app_worksheet', 'manual'],
      ['school_test', 'assessment'],
    ] as const) {
      await service.record({
        childId: child,
        source,
        occurredAt: '2026-08-29T08:00:00Z',
        skillId: 'M4.FRAC.EQUIVALENT',
        result: { correct: true },
        confidenceTier: 'C',
        provenance,
      });
    }
    const history = await service.history(child);
    expect(history).toHaveLength(4);
    expect(new Set(history.map((e) => e.provenance))).toEqual(
      new Set(['parent', 'teacher', 'manual', 'assessment']),
    );
  });

  it('records a teacher contribution (or a parent standing in for one)', async () => {
    const { service } = makeService();
    const tc = await service.recordTeacherContribution({
      childId: child,
      contributedAs: 'parent',
      actorUserId: 'user_thu_ha',
      occurredOn: '2026-08-30',
      taughtSkillIds: ['M7.RATIO.PROPORTION'],
      problemTypeIds: [],
      homeworkRefs: ['SGK tr.12 bài 1-4'],
    });
    expect(tc.id).toBe('tc_id1');
    expect(tc.contributedAs).toBe('parent');
    expect(await service.teacherContributions(child)).toHaveLength(1);
  });

  it('logs each write through the injected logger', async () => {
    const store = new InMemoryLedgerStore();
    const info = vi.fn();
    const logger = { info, warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => logger };
    const service = new EvidenceService({ store, logger });
    await service.record({
      childId: child,
      source: 'app_practice',
      occurredAt: '2026-08-30T10:00:00Z',
      result: { correct: true },
      confidenceTier: 'B',
      provenance: 'parent',
    });
    expect(info).toHaveBeenCalledWith('evidence.recorded', expect.objectContaining({ childId: child }));
  });
});
