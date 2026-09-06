import type { GeneratedItemContent } from '@copilot/domain';
import type { UsageProvider } from '@copilot/ai';
import type {
  ItemContentGenerator,
  ItemGenerationCallOutcome,
  ItemGenerationRequest,
} from './item-generator.js';
import { buildContentFromKernel } from './kernel-templater.js';

/**
 * Fault-injecting test generator (doc 63 §10). A deterministic
 * `ItemContentGenerator` whose behaviour per (itemId, attempt, model role) is
 * scripted, so the recovery state machine can be exercised offline with no
 * network. When not told to fail, it returns kernel-templated content (which
 * passes every gate).
 */

export type FaultMode =
  | 'SIMILARITY'
  | 'DUPLICATE'
  | 'KERNEL_DRIFT'
  | 'SCHEMA'
  | 'LEAKAGE'
  | 'SEMANTIC_UNKNOWN'
  | 'INABILITY';

export interface FaultScript {
  /** fail on attempts 1..failAttempts for this model role; succeed after. */
  readonly failAttempts: number;
  readonly mode: FaultMode;
  /** which role this script applies to; omitted = both. */
  readonly role?: 'default' | 'high';
}

export interface FaultInjectorOptions {
  readonly name: string;
  readonly model: string;
  readonly role: 'default' | 'high';
  /** itemId → script. Absent = always succeed. */
  readonly scripts: Readonly<Record<string, FaultScript>>;
  /** a reference prompt to reproduce verbatim for LEAKAGE mode. */
  readonly leakPrompt?: string;
  readonly latencyMs?: number;
  readonly usage?: { inputTokens: number; outputTokens: number };
  /** default 'mock' (cost 0); set 'openai' to exercise the cost guardrail. */
  readonly provider?: UsageProvider;
}

export function createFaultInjectingGenerator(opts: FaultInjectorOptions): ItemContentGenerator {
  const attemptsSeen = new Map<string, number>();

  const badContent = (
    itemId: string,
    mode: FaultMode,
    good: GeneratedItemContent,
    collide: GeneratedItemContent,
  ): GeneratedItemContent => {
    switch (mode) {
      case 'SIMILARITY':
      case 'DUPLICATE':
        // a valid kernel realization (numbers + answer intact) that reuses a
        // FIXED scenario template → collides with siblings, kernel still passes.
        return { ...collide, itemId };
      case 'KERNEL_DRIFT':
        return {
          ...good,
          itemId,
          workedSolution: 'Ta tính ra một số khác.\nĐáp số: 999999.',
          answer: '999999',
        };
      case 'SCHEMA':
        return { ...good, itemId, answer: 'B' };
      case 'LEAKAGE':
        return { ...good, itemId, prompt: opts.leakPrompt ?? good.prompt };
      case 'SEMANTIC_UNKNOWN':
        return {
          ...good,
          itemId,
          prompt: 'Một cửa hàng bán một ít hàng trong ngày. Hỏi cửa hàng bán bao nhiêu?',
          workedSolution: 'Học sinh tự trình bày lời giải.',
        };
      default:
        return good;
    }
  };

  return {
    name: opts.name,
    provider: opts.provider ?? 'mock',
    model: opts.model,
    modelVersion: `${opts.model}-fault`,
    promptVersion: null,
    generate(request: ItemGenerationRequest): Promise<ItemGenerationCallOutcome> {
      const latencyMs = opts.latencyMs ?? 3;
      const dnas = request.problemDNAs.slice(0, 2);
      if (dnas.length === 0) {
        return Promise.resolve({ ok: false, inability: 'no ProblemDNA', latencyMs });
      }
      const contents: GeneratedItemContent[] = [];
      for (const dna of dnas) {
        const seen = (attemptsSeen.get(dna.itemId) ?? 0) + 1;
        attemptsSeen.set(dna.itemId, seen);
        const good = dna.mathKernel
          ? buildContentFromKernel(dna, 0)
          : {
              itemId: dna.itemId,
              prompt: 'Hãy giải thích vì sao tính chất phân phối của phép nhân với một tổng luôn đúng, cho một ví dụ minh hoạ.',
              answer: '',
              hints: [
                'Đọc kỹ yêu cầu: cần giải thích chứ không chỉ nêu kết quả.',
                'Nhắc lại tính chất: a × (b + c) = a × b + a × c.',
                'Chọn ba số cụ thể để minh hoạ.',
                'Tính hai vế và so sánh.',
                'Giải thích ý nghĩa: nhân với tổng bằng cộng các tích thành phần.',
                'Viết lại lập luận đầy đủ theo từng bước.',
              ],
              workedSolution: 'Xét a × (b + c). Ta cộng b + c trước rồi nhân với a; kết quả bằng a × b + a × c. Ví dụ 3 × (4 + 5) = 3 × 9 = 27 và 3 × 4 + 3 × 5 = 12 + 15 = 27.',
              rubric: 'Nêu đúng tính chất 0,5đ; có ví dụ số cụ thể tính đủ hai vế 0,5đ.',
            };
        // a FIXED-template realization used to force a within-worksheet collision
        const collide = dna.mathKernel
          ? { ...buildContentFromKernel({ ...dna, itemId: dna.itemId.replace(/item-\d+/, 'item-01') }, 0), itemId: dna.itemId }
          : good;
        const script = opts.scripts[dna.itemId];
        const applies = script && (!script.role || script.role === opts.role) && seen <= script.failAttempts;
        if (applies && script.mode === 'INABILITY') {
          return Promise.resolve({ ok: false, inability: `scripted inability for ${dna.itemId}`, latencyMs });
        }
        contents.push(applies ? badContent(dna.itemId, script.mode, good, collide) : good);
      }
      return Promise.resolve({
        ok: true,
        contents,
        latencyMs,
        ...(opts.usage ? { usage: { ...opts.usage } } : {}),
      });
    },
  };
}
