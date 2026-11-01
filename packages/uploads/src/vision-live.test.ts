import { describe, expect, it, vi } from 'vitest';
import {
  MAX_EXTRACTED_ITEMS,
  OpenAiVisionAdapter,
  VisionOutputError,
  parseVisionOutput,
  resolveDocumentVisionAdapter,
  type VisionUsage,
} from './vision.js';

/**
 * Backlog B2-01 — the live vision adapter must never trust the model. These tests use a fake fetch:
 * no network, no key, no cost.
 */
const SKILLS = ['M4.FRAC.ADD', 'M4.FRAC.SUB', 'M4.GEO.AREA'];

const good = {
  documentType: 'HOMEWORK',
  observedOn: '2026-10-20',
  items: [
    {
      index: 7,
      prompt: 'Tính 1/2 + 1/3',
      childAnswer: '5/6',
      markedCorrect: true,
      skillCandidates: [
        { skillId: 'M4.FRAC.SUB', confidence: 0.4 },
        { skillId: 'M4.FRAC.ADD', confidence: 0.9 },
      ],
      problemTypeId: 'made-up-by-the-model',
    },
  ],
  teacherNote: 'Con cần cẩn thận hơn',
  overallConfidence: 0.8,
};

describe('parseVisionOutput', () => {
  it('accepts a good page, re-indexes, ranks candidates and never lets the model set problemTypeId', () => {
    const r = parseVisionOutput(good, SKILLS);
    expect(r.documentType).toBe('HOMEWORK');
    expect(r.observedOn).toBe('2026-10-20');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ index: 0, prompt: 'Tính 1/2 + 1/3', childAnswer: '5/6', markedCorrect: true, problemTypeId: null });
    expect(r.items[0]!.skillCandidates.map((c) => c.skillId)).toEqual(['M4.FRAC.ADD', 'M4.FRAC.SUB']);
  });

  it('rejects the wrong shape instead of returning an empty success (the documented "questions" failure)', () => {
    expect(() => parseVisionOutput({ questions: [{ question: 'x', answer: 'y' }] }, SKILLS)).toThrow(VisionOutputError);
    expect(() => parseVisionOutput('nope', SKILLS)).toThrow(VisionOutputError);
    expect(() => parseVisionOutput(null, SKILLS)).toThrow(VisionOutputError);
  });

  it('drops skill ids the model invented and out-of-range confidences are clamped', () => {
    const r = parseVisionOutput(
      { ...good, items: [{ prompt: 'a', skillCandidates: [{ skillId: 'M9.INVENTED', confidence: 0.99 }, { skillId: 'M4.GEO.AREA', confidence: 7 }] }] },
      SKILLS,
    );
    expect(r.items[0]!.skillCandidates).toEqual([{ skillId: 'M4.GEO.AREA', confidence: 1 }]);
  });

  it('caps candidates per item and the number of items', () => {
    const many = Array.from({ length: MAX_EXTRACTED_ITEMS + 25 }, (_, i) => ({ prompt: `câu ${i}` }));
    expect(parseVisionOutput({ items: many }, SKILLS).items).toHaveLength(MAX_EXTRACTED_ITEMS);
    const r = parseVisionOutput(
      { items: [{ prompt: 'a', skillCandidates: SKILLS.concat(SKILLS).map((skillId) => ({ skillId, confidence: 0.5 })) }] },
      SKILLS,
    );
    expect(r.items[0]!.skillCandidates.length).toBeLessThanOrEqual(3);
    expect(new Set(r.items[0]!.skillCandidates.map((c) => c.skillId)).size).toBe(r.items[0]!.skillCandidates.length);
  });

  it('fails the page when most items are unreadable, but tolerates a stray bad one', () => {
    const tolerated = parseVisionOutput({ items: [{ prompt: 'ok 1' }, { prompt: 'ok 2' }, { prompt: '' }] }, SKILLS);
    expect(tolerated.items).toHaveLength(2);
    expect(() => parseVisionOutput({ items: [{ prompt: '' }, 42, null, { prompt: 'ok' }] }, SKILLS)).toThrow(/readable/);
  });

  it('ignores a nonsense or far-future date and an unknown document type', () => {
    expect(parseVisionOutput({ ...good, observedOn: '2099-01-01' }, SKILLS).observedOn).toBeNull();
    expect(parseVisionOutput({ ...good, observedOn: '31/12/2026' }, SKILLS).observedOn).toBeNull();
    expect(parseVisionOutput({ ...good, documentType: 'RECIPE' }, SKILLS).documentType).toBe('UNKNOWN');
  });

  it('never claims high confidence for an empty page', () => {
    const r = parseVisionOutput({ documentType: 'UNKNOWN', items: [], overallConfidence: 0.95 }, SKILLS);
    expect(r.overallConfidence).toBeLessThanOrEqual(0.3);
  });
});

function fakeFetch(content: unknown, usage = { prompt_tokens: 1200, completion_tokens: 300 }, ok = true): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage }),
  }) as unknown as typeof fetch;
}

const input = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg',
  childGrade: 4,
  kindHint: 'HOMEWORK' as const,
  knownSkillIds: SKILLS,
  usageContext: { userRef: 'u_ref', childRef: 'c_ref' },
};

describe('OpenAiVisionAdapter (fake fetch)', () => {
  it('returns a validated extraction and reports usage with the pseudonymous context', async () => {
    const seen: { usage: VisionUsage; ctx: unknown }[] = [];
    const adapter = new OpenAiVisionAdapter({ apiKey: 'k', fetchImpl: fakeFetch(good), onUsage: (usage, ctx) => seen.push({ usage, ctx }) });
    const r = await adapter.analyze(input);
    expect(r.items).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.usage).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1200, outputTokens: 300, imageCount: 1, schemaValid: true });
    expect(seen[0]!.ctx).toEqual({ userRef: 'u_ref', childRef: 'c_ref' });
  });

  it('still reports the (billed) usage when the model output is rejected, and throws', async () => {
    const seen: VisionUsage[] = [];
    const adapter = new OpenAiVisionAdapter({ apiKey: 'k', fetchImpl: fakeFetch({ questions: [] }), onUsage: (u) => seen.push(u) });
    await expect(adapter.analyze(input)).rejects.toThrow(VisionOutputError);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ schemaValid: false, inputTokens: 1200 });
  });

  it('rejects non-JSON text and an empty response as unusable', async () => {
    await expect(new OpenAiVisionAdapter({ apiKey: 'k', fetchImpl: fakeFetch('sorry, I cannot') }).analyze(input)).rejects.toThrow(/not valid JSON/);
    const empty = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ choices: [] }) }) as unknown as typeof fetch;
    await expect(new OpenAiVisionAdapter({ apiKey: 'k', fetchImpl: empty }).analyze(input)).rejects.toThrow(/empty response/);
  });

  it('refuses unsupported file types before spending anything', async () => {
    const fetchImpl = fakeFetch(good);
    const adapter = new OpenAiVisionAdapter({ apiKey: 'k', fetchImpl });
    await expect(adapter.analyze({ ...input, mimeType: 'application/pdf' })).rejects.toThrow(/unsupported image type/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces provider HTTP errors without reporting usage', async () => {
    const seen: VisionUsage[] = [];
    const adapter = new OpenAiVisionAdapter({ apiKey: 'k', fetchImpl: fakeFetch(good, undefined, false), onUsage: (u) => seen.push(u) });
    await expect(adapter.analyze(input)).rejects.toThrow(/failed: 500/);
    expect(seen).toEqual([]);
  });

  it('times out a hung provider', async () => {
    const hang = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    const adapter = new OpenAiVisionAdapter({ apiKey: 'k', fetchImpl: hang, timeoutMs: 20 });
    await expect(adapter.analyze(input)).rejects.toThrow(/timed out/);
  });
});

describe('resolveDocumentVisionAdapter', () => {
  it('is the free mock unless BOTH the flag and a key are set', () => {
    expect(resolveDocumentVisionAdapter({}).kind).toBe('mock');
    expect(resolveDocumentVisionAdapter({ DZ_LIVE_VISION: '1' }).kind).toBe('mock');
    expect(resolveDocumentVisionAdapter({ OPENAI_API_KEY: 'k' }).kind).toBe('mock');
    expect(resolveDocumentVisionAdapter({ DZ_LIVE_VISION: '1', OPENAI_API_KEY: 'k' }).kind).toBe('openai');
  });
});
