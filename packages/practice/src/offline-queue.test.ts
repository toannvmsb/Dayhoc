import { describe, expect, it, vi } from 'vitest';
import { asChildId, type Submission } from '@copilot/domain';
import { MemoryQueuePersistence, OfflineSubmissionQueue } from './offline-queue.js';

const sub = (id: string): Submission => ({
  id,
  assignmentId: 'asg_1',
  questionId: 'Q.1',
  childId: asChildId('c'),
  childAnswer: 'x',
  correct: true,
  score: 1,
  hintsUsed: 0,
  maxHints: 6,
  timeSpentSeconds: 40,
  submittedAt: '2026-08-31T08:00:00Z',
});

describe('OfflineSubmissionQueue (UI/UX Spec §17)', () => {
  it('queues submissions and flushes them in FIFO order when back online', async () => {
    const q = new OfflineSubmissionQueue(new MemoryQueuePersistence());
    await q.enqueue(sub('s1'));
    await q.enqueue(sub('s2'));
    const seen: string[] = [];
    const res = await q.flush((s) => {
      seen.push(s.id);
      return Promise.resolve(true);
    });
    expect(seen).toEqual(['s1', 's2']);
    expect(res).toEqual({ sent: 2, remaining: 0 });
  });

  it('is idempotent — the same submission is not queued twice', async () => {
    const q = new OfflineSubmissionQueue(new MemoryQueuePersistence());
    await q.enqueue(sub('s1'));
    await q.enqueue(sub('s1'));
    expect(await q.pending()).toHaveLength(1);
  });

  it('stops flushing on the first failure and keeps the rest (order preserved)', async () => {
    const q = new OfflineSubmissionQueue(new MemoryQueuePersistence());
    await q.enqueue(sub('s1'));
    await q.enqueue(sub('s2'));
    await q.enqueue(sub('s3'));
    const send = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const res = await q.flush(send);
    expect(res).toEqual({ sent: 1, remaining: 2 });
    const remaining = await q.pending();
    expect(remaining.map((r) => r.submission.id)).toEqual(['s2', 's3']);
    expect(remaining[0]!.attempts).toBe(1);
  });
});
