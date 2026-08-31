import type { Submission } from '@copilot/domain';

/**
 * Offline submission queue (UI/UX Spec §17 "No internet": queue submission if
 * appropriate). A tiny, storage-agnostic FIFO the child app uses to hold
 * submissions made while offline and flush them in order when connectivity
 * returns. Pure data structure + a pluggable persistence port.
 */
export interface QueuePersistence {
  read(): Promise<readonly QueuedSubmission[]>;
  write(items: readonly QueuedSubmission[]): Promise<void>;
}

export interface QueuedSubmission {
  readonly submission: Submission;
  readonly questionId: string;
  readonly enqueuedAt: string; // ISO
  readonly attempts: number;
}

export class OfflineSubmissionQueue {
  constructor(private readonly store: QueuePersistence) {}

  async enqueue(submission: Submission): Promise<void> {
    const items = [...(await this.store.read())];
    if (items.some((i) => i.submission.id === submission.id)) return; // idempotent
    items.push({
      submission,
      questionId: submission.questionId,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    });
    await this.store.write(items);
  }

  async pending(): Promise<readonly QueuedSubmission[]> {
    return this.store.read();
  }

  /**
   * Flush in FIFO order. `send` returns true on success; a failed item stays in
   * the queue (attempts incremented) and flushing stops so order is preserved.
   */
  async flush(send: (s: Submission) => Promise<boolean>): Promise<{ sent: number; remaining: number }> {
    const items = [...(await this.store.read())];
    let sent = 0;
    while (items.length > 0) {
      const head = items[0]!;
      const ok = await send(head.submission);
      if (!ok) {
        items[0] = { ...head, attempts: head.attempts + 1 };
        break;
      }
      items.shift();
      sent += 1;
    }
    await this.store.write(items);
    return { sent, remaining: items.length };
  }
}

/** In-memory persistence for tests / SSR. */
export class MemoryQueuePersistence implements QueuePersistence {
  #items: readonly QueuedSubmission[] = [];
  read(): Promise<readonly QueuedSubmission[]> {
    return Promise.resolve(this.#items);
  }
  write(items: readonly QueuedSubmission[]): Promise<void> {
    this.#items = items;
    return Promise.resolve();
  }
}
