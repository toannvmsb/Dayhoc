import { createHash } from 'node:crypto';
import type { DocumentExtraction, DocumentType, ExtractedItem, UploadKind } from '@copilot/domain';

export interface VisionAnalyzeInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly childGrade: number;
  readonly kindHint: UploadKind;
  /** Skill IDs the mapper is allowed to propose (the child's grade band). */
  readonly knownSkillIds: readonly string[];
  /** Pseudonymous refs for the AI cost ledger; the adapter never sees a raw id. */
  readonly usageContext?: VisionUsageContext;
}

export interface VisionUsageContext {
  readonly userRef: string;
  readonly childRef: string | null;
}

/** What one live vision call consumed — reported even when its output is rejected. */
export interface VisionUsage {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly imageCount: number;
  /** false when the response failed schema validation (still billed). */
  readonly schemaValid: boolean;
}

export type VisionUsageSink = (usage: VisionUsage, context: VisionUsageContext | undefined) => void;

/**
 * Document-vision port: turn an uploaded page into a structured, skill-mapped
 * extraction. NO implementation here makes a paid call unless it is explicitly
 * constructed with real credentials AND selected.
 */
export interface DocumentVisionAdapter {
  readonly name: string;
  readonly extractionVersion: string;
  readonly provider: string;
  readonly model: string;
  analyze(input: VisionAnalyzeInput): Promise<DocumentExtraction>;
}

function hashInt(bytes: Uint8Array, salt: string): number {
  const h = createHash('sha256').update(salt).update(bytes).digest();
  return h.readUInt32BE(0);
}

interface MockScenario {
  readonly documentType: DocumentType;
  readonly kind: UploadKind;
  readonly itemCount: number;
  readonly graded: boolean;
  readonly teacherNote: string | null;
  readonly baseConfidence: number;
}

const SCENARIOS: readonly MockScenario[] = [
  { documentType: 'WORKSHEET', kind: 'NOTEBOOK_PAGE', itemCount: 3, graded: false, teacherNote: null, baseConfidence: 0.82 },
  { documentType: 'GRADED_TEST', kind: 'GRADED_TEST', itemCount: 5, graded: true, teacherNote: 'Con cần cẩn thận phần trình bày.', baseConfidence: 0.74 },
  { documentType: 'HOMEWORK', kind: 'HOMEWORK', itemCount: 4, graded: true, teacherNote: null, baseConfidence: 0.68 },
  { documentType: 'TEACHER_NOTE', kind: 'TEACHER_MESSAGE', itemCount: 0, graded: false, teacherNote: 'Tuần này lớp học phép cộng phân số khác mẫu.', baseConfidence: 0.55 },
];

/** Scenarios that actually produce items to review — every kind except a bare teacher message. */
const SCENARIOS_WITH_ITEMS = SCENARIOS.filter((s) => s.itemCount > 0);

/**
 * Pick the mock scenario for this upload. The scenario MUST match what the
 * parent told us they were uploading (`kindHint`) — earlier this picked a
 * scenario purely from a content hash, so a parent uploading a "Bài kiểm tra
 * đã chấm" could randomly land on the zero-item TEACHER_MESSAGE scenario and
 * see a review screen with no items to tick, only the note + Confirm/Later.
 * Randomness (via the hash) is kept only for `OTHER`, and only among
 * scenarios that actually have items.
 */
function pickScenario(kindHint: UploadKind, bytes: Uint8Array): MockScenario {
  const byKind = SCENARIOS.find((s) => s.kind === kindHint);
  if (byKind) return byKind;
  return SCENARIOS_WITH_ITEMS[hashInt(bytes, 'scenario') % SCENARIOS_WITH_ITEMS.length]!;
}

/**
 * Deterministic mock vision adapter — the DEV/LOCAL default. Same bytes → same
 * extraction. Produces a realistic mix of high- and low-confidence item
 * mappings so the parent-review flow is exercised. Never touches the network.
 */
export class MockDocumentVisionAdapter implements DocumentVisionAdapter {
  readonly name = 'mock';
  readonly extractionVersion = 'mock-vision.v1';
  readonly provider = 'mock';
  readonly model = 'mock';

  analyze(input: VisionAnalyzeInput): Promise<DocumentExtraction> {
    const scenario = pickScenario(input.kindHint, input.bytes);
    const skills = input.knownSkillIds.length > 0 ? input.knownSkillIds : ['UNKNOWN_SKILL'];

    const items: ExtractedItem[] = [];
    for (let i = 0; i < scenario.itemCount; i += 1) {
      const skillIdx = hashInt(input.bytes, `skill${i}`) % skills.length;
      const altIdx = (skillIdx + 1) % skills.length;
      // deterministically make ~1 in 3 items low-confidence
      const low = hashInt(input.bytes, `low${i}`) % 3 === 0;
      const primaryConf = low ? 0.42 : Math.min(0.95, scenario.baseConfidence + 0.1);
      const marked = scenario.graded ? hashInt(input.bytes, `mark${i}`) % 3 !== 0 : null;
      items.push({
        index: i,
        prompt: `Câu ${i + 1} (trích từ ảnh tải lên)`,
        childAnswer: scenario.graded ? String((hashInt(input.bytes, `ans${i}`) % 90) + 10) : null,
        markedCorrect: marked,
        problemTypeId: null,
        skillCandidates:
          skills[0] === 'UNKNOWN_SKILL'
            ? []
            : [
                { skillId: skills[skillIdx]!, confidence: primaryConf },
                { skillId: skills[altIdx]!, confidence: Math.max(0.2, primaryConf - 0.25) },
              ],
      });
    }

    const overall =
      items.length === 0
        ? scenario.baseConfidence
        : items.reduce((s, it) => s + (it.skillCandidates[0]?.confidence ?? 0.3), 0) / items.length;

    const observedOffsetDays = hashInt(input.bytes, 'date') % 10;
    const observedOn = new Date(Date.now() - observedOffsetDays * 86_400_000)
      .toISOString()
      .slice(0, 10);

    return Promise.resolve({
      documentType: scenario.documentType,
      observedOn,
      items,
      teacherNote: scenario.teacherNote,
      overallConfidence: Number(overall.toFixed(3)),
    });
  }
}

export class VisionCredentialsRequiredError extends Error {
  readonly code = 'VISION_ENV_REQUIRED';
  constructor() {
    super('the live document-vision adapter needs OPENAI_API_KEY (ENV_REQUIRED)');
    this.name = 'VisionCredentialsRequiredError';
  }
}

export interface OpenAiVisionConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
  /** Called after every live call (success or rejected output) so cost is never lost. */
  readonly onUsage?: VisionUsageSink;
  /** Per-call timeout; a hung provider must not hold a request open. Default 60 s. */
  readonly timeoutMs?: number;
}

/**
 * The exact JSON contract, spelled out field-by-field — an earlier one-line
 * version ("Return JSON matching DocumentExtraction") let the model invent
 * its own reasonable-looking-but-wrong shape (`questions`/`question`/`answer`/
 * `marks` instead of `items`/`prompt`/`childAnswer`/`markedCorrect`/
 * `skillCandidates`), confirmed against a real photo before this fix. Same
 * lesson as `EXERCISE_GENERATOR_SYSTEM_PROMPT` in `@copilot/exercise-gen`:
 * an AI JSON contract must be given explicitly, never implied by a type name.
 */
const VISION_SYSTEM_PROMPT = `Read this photo of a Vietnamese primary/lower-secondary math homework or test page. Respond with a single JSON object matching this exact shape:
{
  "documentType": "WORKSHEET" | "GRADED_TEST" | "HOMEWORK" | "TEACHER_NOTE" | "UNKNOWN",
  "observedOn": "<ISO date YYYY-MM-DD if a date is legible on the page, else null>",
  "items": [
    {
      "index": <0-based integer, top-to-bottom reading order>,
      "prompt": "<the question text, transcribed as written, Vietnamese>",
      "childAnswer": "<the child's handwritten answer, or null if none/illegible>",
      "markedCorrect": <true if a teacher mark shows it correct, false if marked wrong, null if not graded/no mark visible>,
      "skillCandidates": [{"skillId": "<must be one of the allowed skillIds given by the caller>", "confidence": <0..1>}],
      "problemTypeId": null
    }
  ],
  "teacherNote": "<any separate teacher note/message on the page, or null>",
  "overallConfidence": <0..1 — your own confidence in this whole extraction>
}
Only include an exercise/question as an "item" — never the page header, "kiến thức cần nhớ" reference boxes, or decorative text. Only propose "skillId" values from the allowed list given by the caller; if none fit confidently, return an empty skillCandidates array rather than guessing. No prose outside the JSON object.`;

// ---------------------------------------------------------------------------
// output validation — AI output is never trusted (CLAUDE.md: schema + confidence + fallback)
// ---------------------------------------------------------------------------

export const MAX_EXTRACTED_ITEMS = 60;
const MAX_CANDIDATES_PER_ITEM = 3;
const MAX_PROMPT_CHARS = 2000;
const MAX_ANSWER_CHARS = 500;
const MAX_NOTE_CHARS = 1000;
const DOCUMENT_TYPES: readonly DocumentType[] = ['WORKSHEET', 'GRADED_TEST', 'HOMEWORK', 'TEACHER_NOTE', 'UNKNOWN'];

/** The model's answer could not be turned into a valid extraction. Billed, but never shown or stored as evidence. */
export class VisionOutputError extends Error {
  readonly code = 'VISION_OUTPUT_INVALID';
  constructor(detail: string) {
    super(`the vision model returned an unusable result (${detail})`);
    this.name = 'VisionOutputError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function cleanText(v: unknown, max: number): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
}

function cleanDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const year = Number(v.slice(0, 4));
  return year >= 2000 && t <= Date.now() + 2 * 86_400_000 ? v : null;
}

/**
 * Turn the raw model JSON into a `DocumentExtraction`, or throw `VisionOutputError`.
 *  - the wrong top-level shape (e.g. `questions` instead of `items`) is an error, never an empty success;
 *  - skill ids outside the caller's allow-list are dropped (the model cannot invent skill ids);
 *  - the model never sets `problemTypeId`; confidences are clamped; sizes are capped;
 *  - items without a readable prompt are dropped, and if most of the page is garbage the call fails.
 */
export function parseVisionOutput(raw: unknown, allowedSkillIds: readonly string[]): DocumentExtraction {
  if (!isRecord(raw)) throw new VisionOutputError('not a JSON object');
  const rawList = raw['items'];
  if (!Array.isArray(rawList)) throw new VisionOutputError('missing "items" array');

  const allowed = new Set(allowedSkillIds);
  const documentType = DOCUMENT_TYPES.includes(raw['documentType'] as DocumentType) ? (raw['documentType'] as DocumentType) : 'UNKNOWN';

  const rawItems: unknown[] = rawList.slice(0, MAX_EXTRACTED_ITEMS);
  const items: ExtractedItem[] = [];
  for (const r of rawItems) {
    if (!isRecord(r)) continue;
    const prompt = cleanText(r['prompt'], MAX_PROMPT_CHARS);
    if (prompt === null) continue;
    const seen = new Set<string>();
    const candidates: { skillId: string; confidence: number }[] = [];
    const rawCandidates = r['skillCandidates'];
    if (Array.isArray(rawCandidates)) {
      for (const c of rawCandidates as unknown[]) {
        if (!isRecord(c)) continue;
        const skillId = c['skillId'];
        if (typeof skillId !== 'string' || !allowed.has(skillId) || seen.has(skillId)) continue;
        const conf = c['confidence'];
        seen.add(skillId);
        candidates.push({ skillId, confidence: typeof conf === 'number' && Number.isFinite(conf) ? clamp01(conf) : 0 });
      }
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    items.push({
      index: items.length,
      prompt,
      childAnswer: cleanText(r['childAnswer'], MAX_ANSWER_CHARS),
      markedCorrect: typeof r['markedCorrect'] === 'boolean' ? r['markedCorrect'] : null,
      skillCandidates: candidates.slice(0, MAX_CANDIDATES_PER_ITEM),
      problemTypeId: null,
    });
  }
  if (rawItems.length > 0 && items.length * 2 < rawItems.length) {
    throw new VisionOutputError(`only ${items.length} of ${rawItems.length} items were readable`);
  }

  const statedRaw = raw['overallConfidence'];
  const stated = typeof statedRaw === 'number' && Number.isFinite(statedRaw) ? clamp01(statedRaw) : 0.4;
  return {
    documentType,
    observedOn: cleanDate(raw['observedOn']),
    items,
    teacherNote: cleanText(raw['teacherNote'], MAX_NOTE_CHARS),
    // never claim more certainty than the page supports: an empty result is low-confidence by definition
    overallConfidence: items.length === 0 && documentType !== 'TEACHER_NOTE' ? Math.min(stated, 0.3) : stated,
  };
}

export const LIVE_VISION_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Live OpenAI vision adapter. Only ever constructed when a key exists AND `DZ_LIVE_VISION=1`; it is
 * never the default, so no upload triggers a paid call unless an operator opts in. Output goes through
 * `parseVisionOutput`; a rejected result throws `VisionOutputError` (the pipeline marks the upload
 * FAILED and the parent can retry) — it never reaches the review screen. Every call reports its token
 * usage through `onUsage`, including calls whose output was rejected, so the cost ledger is complete.
 */
export class OpenAiVisionAdapter implements DocumentVisionAdapter {
  readonly name = 'openai';
  readonly extractionVersion = 'openai-vision.v2';
  readonly provider = 'openai';
  readonly model: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #onUsage: VisionUsageSink | undefined;
  readonly #timeoutMs: number;

  constructor(cfg: OpenAiVisionConfig) {
    if (!cfg.apiKey) throw new VisionCredentialsRequiredError();
    this.#apiKey = cfg.apiKey;
    // `gpt-5.6-luna` (this codebase's "Luna" — see @copilot/ai pricing.ts) is
    // a FICTIONAL model id used for cost-simulation only; calling the real
    // OpenAI API with it would 404. Default to a real, vision-capable,
    // low-cost model instead; override via `OPENAI_VISION_MODEL` or `cfg.model`.
    this.model = cfg.model ?? 'gpt-4o-mini';
    this.#fetch = cfg.fetchImpl ?? globalThis.fetch;
    this.#onUsage = cfg.onUsage;
    this.#timeoutMs = cfg.timeoutMs ?? 60_000;
  }

  async analyze(input: VisionAnalyzeInput): Promise<DocumentExtraction> {
    if (!LIVE_VISION_MIME_TYPES.includes(input.mimeType)) {
      throw new VisionOutputError(`unsupported image type ${input.mimeType}`);
    }
    const started = Date.now();
    const b64 = Buffer.from(input.bytes).toString('base64');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: VISION_SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: `grade=${input.childGrade}; allowed skillIds=${input.knownSkillIds.join(',')}` },
                { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${b64}` } },
              ],
            },
          ],
        }),
      });
    } catch (err) {
      throw new Error(
        controller.signal.aborted ? 'openai vision timed out' : `openai vision request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`openai vision failed: ${res.status}`);

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const report = (schemaValid: boolean): void => {
      this.#onUsage?.(
        {
          provider: this.provider,
          model: this.model,
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
          latencyMs: Date.now() - started,
          imageCount: 1,
          schemaValid,
        },
        input.usageContext,
      );
    };

    let extraction: DocumentExtraction;
    try {
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new VisionOutputError('empty response');
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        throw new VisionOutputError('response is not valid JSON');
      }
      extraction = parseVisionOutput(json, input.knownSkillIds);
    } catch (err) {
      report(false);
      throw err;
    }
    report(true);
    return extraction;
  }
}

export interface VisionEnv {
  readonly DZ_LIVE_VISION?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
  readonly OPENAI_VISION_MODEL?: string | undefined;
}

/**
 * Pick the vision adapter. The mock is the default EVERYWHERE. The live adapter
 * is chosen only when an operator sets `DZ_LIVE_VISION=1` and a key is present —
 * an upload never spends money by accident.
 */
export function resolveDocumentVisionAdapter(
  env: VisionEnv,
  hooks: { onUsage?: VisionUsageSink } = {},
): {
  adapter: DocumentVisionAdapter;
  kind: 'mock' | 'openai';
} {
  if (env.DZ_LIVE_VISION === '1' && env.OPENAI_API_KEY) {
    return {
      adapter: new OpenAiVisionAdapter({
        apiKey: env.OPENAI_API_KEY,
        ...(env.OPENAI_VISION_MODEL ? { model: env.OPENAI_VISION_MODEL } : {}),
        ...(hooks.onUsage ? { onUsage: hooks.onUsage } : {}),
      }),
      kind: 'openai',
    };
  }
  return { adapter: new MockDocumentVisionAdapter(), kind: 'mock' };
}
