import { createHash } from 'node:crypto';
import type { DocumentExtraction, DocumentType, ExtractedItem, UploadKind } from '@copilot/domain';

export interface VisionAnalyzeInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly childGrade: number;
  readonly kindHint: UploadKind;
  /** Skill IDs the mapper is allowed to propose (the child's grade band). */
  readonly knownSkillIds: readonly string[];
}

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
}

/**
 * Live OpenAI vision adapter. Present for completeness; it is only ever
 * constructed when a key exists AND `DZ_LIVE_VISION=1`. It is never the default,
 * so no upload triggers a paid call unless an operator opts in.
 */
export class OpenAiVisionAdapter implements DocumentVisionAdapter {
  readonly name = 'openai';
  readonly extractionVersion = 'openai-vision.v1';
  readonly provider = 'openai';
  readonly model: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(cfg: OpenAiVisionConfig) {
    if (!cfg.apiKey) throw new VisionCredentialsRequiredError();
    this.#apiKey = cfg.apiKey;
    this.model = cfg.model ?? 'gpt-5.6-luna';
    this.#fetch = cfg.fetchImpl ?? globalThis.fetch;
  }

  async analyze(input: VisionAnalyzeInput): Promise<DocumentExtraction> {
    // Intentionally minimal — this path is not exercised in dev/test/CI.
    const b64 = Buffer.from(input.bytes).toString('base64');
    const res = await this.#fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Extract questions, the child answers, any teacher marks, and a teacher note from this school page. Return JSON matching DocumentExtraction. Only propose skillIds from the provided list.',
          },
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
    if (!res.ok) throw new Error(`openai vision failed: ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<DocumentExtraction>;
    return {
      documentType: parsed.documentType ?? 'UNKNOWN',
      observedOn: parsed.observedOn ?? null,
      items: parsed.items ?? [],
      teacherNote: parsed.teacherNote ?? null,
      overallConfidence: parsed.overallConfidence ?? 0.4,
    };
  }
}

export interface VisionEnv {
  readonly DZ_LIVE_VISION?: string | undefined;
  readonly OPENAI_API_KEY?: string | undefined;
}

/**
 * Pick the vision adapter. The mock is the default EVERYWHERE. The live adapter
 * is chosen only when an operator sets `DZ_LIVE_VISION=1` and a key is present —
 * an upload never spends money by accident.
 */
export function resolveDocumentVisionAdapter(env: VisionEnv): {
  adapter: DocumentVisionAdapter;
  kind: 'mock' | 'openai';
} {
  if (env.DZ_LIVE_VISION === '1' && env.OPENAI_API_KEY) {
    return { adapter: new OpenAiVisionAdapter({ apiKey: env.OPENAI_API_KEY }), kind: 'openai' };
  }
  return { adapter: new MockDocumentVisionAdapter(), kind: 'mock' };
}
