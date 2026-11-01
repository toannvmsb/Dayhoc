import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { InMemoryUploadStorageAdapter } from '@copilot/uploads';
import { createProductionApi } from './production-api.js';
import { visionUsageEvent, visionLimitsFromEnv } from './vision-cost.js';

/**
 * Backlog B2-01 — the LIVE document-vision path, with `fetch` stubbed: no network, no key, no cost.
 * It proves the guard rails that must hold before anyone flips DZ_LIVE_VISION on:
 *   - no consent → no paid call;  - every call (valid or rejected) lands in the AI cost ledger;
 *   - the model's output is validated;  - daily ceilings stop a runaway.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe('visionUsageEvent / limits (pure)', () => {
  const ctx = { userRef: 'u1', childRef: 'c1' };
  const base = { provider: 'openai', imageCount: 1, latencyMs: 900, schemaValid: true };

  it('prices a known model from the registry (tokens x effective-dated price)', () => {
    const e = visionUsageEvent({ ...base, model: 'gpt-4o-mini', inputTokens: 1_000_000, outputTokens: 1_000_000 }, ctx, new Date('2026-11-01T00:00:00Z'));
    expect(e.operationType).toBe('vision_extraction');
    expect(e.actualCostUsd).toBeCloseTo(0.75, 5); // 0.15 + 0.60 per 1M tokens
    expect(e.priceConfigEffectiveDate).not.toBeNull();
    expect(e.imageCount).toBe(1);
    expect(e.userRef).toBe('u1');
  });

  it('records an unpriced model as unpriced rather than as free', () => {
    const e = visionUsageEvent({ ...base, model: 'some-new-model', inputTokens: 500, outputTokens: 500 }, ctx, new Date());
    expect(e.priceConfigEffectiveDate).toBeNull();
    expect(e.actualCostUsd).toBeNull();
  });

  it('keeps a rejected output in the ledger', () => {
    const e = visionUsageEvent({ ...base, model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 100, schemaValid: false }, ctx, new Date());
    expect(e.schemaValid).toBe(false);
    expect(e.actualCostUsd).toBeGreaterThan(0);
  });

  it('daily limits come from env but fall back to safe defaults on garbage', () => {
    expect(visionLimitsFromEnv({})).toEqual({ perChild: 10, global: 100 });
    expect(visionLimitsFromEnv({ DZ_VISION_DAILY_PER_CHILD: '3', DZ_VISION_DAILY_GLOBAL: '7' })).toEqual({ perChild: 3, global: 7 });
    expect(visionLimitsFromEnv({ DZ_VISION_DAILY_PER_CHILD: '-1', DZ_VISION_DAILY_GLOBAL: 'lots' })).toEqual({ perChild: 10, global: 100 });
  });
});

describe.skipIf(!DATABASE_URL)('live vision through the API (fetch stubbed)', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date();
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];
  const saved = { live: process.env.DZ_LIVE_VISION, key: process.env.OPENAI_API_KEY, perChild: process.env.DZ_VISION_DAILY_PER_CHILD };
  const fetchMock = vi.fn();

  const goodBody = (skillId: string) => ({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        usage: { prompt_tokens: 2000, completion_tokens: 400 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                documentType: 'HOMEWORK',
                observedOn: null,
                items: [{ prompt: 'Tính 1/2 + 1/3', childAnswer: '5/6', markedCorrect: true, skillCandidates: [{ skillId, confidence: 0.9 }] }],
                teacherNote: null,
                overallConfidence: 0.8,
              }),
            },
          },
        ],
      }),
  });

  async function reg(email: string) {
    const me = await api.register({ email, password: 'supersecret', intendedRole: 'PARENT', displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  async function newChild(tag: string) {
    const parent = await reg(`lv-${tag}-${Date.now()}@x.com`);
    const auth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(auth, { displayName: `Bé ${tag}`, schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    return { auth, childId: child.childId };
  }

  const upload = (auth: { bearer: string; workspace: 'PARENT' }, childId: string, tag: string) =>
    api.createUpload(auth, childId, {
      kind: 'HOMEWORK',
      filename: `${tag}.jpg`,
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from(`img-${tag}`.repeat(50)).toString('base64'),
    });

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    process.env.DZ_LIVE_VISION = '1';
    process.env.OPENAI_API_KEY = 'test-key-not-real';
    process.env.DZ_VISION_DAILY_PER_CHILD = '2';
    vi.stubGlobal('fetch', fetchMock);
    api = createProductionApi({
      pool,
      authAdapter: new InMemoryAuthAdapter(`lv${Date.now()}`),
      now,
      uploadStorage: new InMemoryUploadStorageAdapter(),
    });
  }, 20_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    for (const [k, v] of [
      ['DZ_LIVE_VISION', saved.live],
      ['OPENAI_API_KEY', saved.key],
      ['DZ_VISION_DAILY_PER_CHILD', saved.perChild],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of ['upload_analysis', 'uploads', 'consent_records', 'child_profiles']) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 20_000);

  const ledgerRows = async (childId: string) => {
    // the sink is fire-and-forget; give the INSERT a beat
    await new Promise((r) => setTimeout(r, 150));
    const ref = (await import('node:crypto')).createHash('sha256').update(childId).digest('hex').slice(0, 16);
    return (
      await pool.query(
        `SELECT operation_type, provider, model, input_tokens, output_tokens, image_count, schema_valid, actual_cost_usd
           FROM ai_usage_events WHERE child_ref = $1 AND operation_type = 'vision_extraction'`,
        [ref],
      )
    ).rows;
  };

  it('without the guardian consent there is no paid call at all', async () => {
    fetchMock.mockClear();
    const { auth, childId } = await newChild('noconsent');
    const { uploadId } = await upload(auth, childId, 'nc');
    await expect(api.runUploadAnalysis(auth, childId, uploadId)).rejects.toThrow(/đồng ý/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with consent: validated result + one ledger row with tokens and a priced cost', async () => {
    fetchMock.mockReset();
    const { auth, childId } = await newChild('ok');
    await api.setConsent(auth, childId, 'document_reading', true);
    const skillId = 'M4.FRAC.ADD.UNLIKE'; // not necessarily real — must be dropped unless it is in the grade band
    fetchMock.mockResolvedValue(goodBody(skillId));
    const { uploadId } = await upload(auth, childId, 'ok');
    const a = await api.runUploadAnalysis(auth, childId, uploadId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.state).toBe('NEEDS_CONFIRMATION');
    expect(a.items).toHaveLength(1);
    // an id outside the child's grade band can never come back as a candidate
    expect(a.items[0]!.skillCandidates.every((c) => c.skillId !== 'M9.INVENTED')).toBe(true);

    const rows = await ledgerRows(childId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', input_tokens: 2000, output_tokens: 400, image_count: 1, schema_valid: true });
    expect(Number(rows[0].actual_cost_usd)).toBeGreaterThan(0);
    // the parent-facing DTO exposes no usage / cost
    expect(JSON.stringify(a)).not.toMatch(/inputTokens|usage|cost/i);
  });

  it('a malformed model answer FAILS the upload, never reaches review, and is still billed in the ledger', async () => {
    fetchMock.mockReset();
    const { auth, childId } = await newChild('bad');
    await api.setConsent(auth, childId, 'document_reading', true);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ usage: { prompt_tokens: 1500, completion_tokens: 50 }, choices: [{ message: { content: '{"questions":[{"question":"x"}]}' } }] }),
    });
    const { uploadId } = await upload(auth, childId, 'bad');
    const a = await api.runUploadAnalysis(auth, childId, uploadId);
    expect(a.state).toBe('FAILED');
    expect(a.errorCode).toBe('VISION_OUTPUT_INVALID');
    expect(a.items).toEqual([]);
    const rows = await ledgerRows(childId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ schema_valid: false, input_tokens: 1500 });
  });

  it('the per-child daily ceiling stops further paid reads', async () => {
    fetchMock.mockReset();
    const { auth, childId } = await newChild('cap');
    await api.setConsent(auth, childId, 'document_reading', true);
    fetchMock.mockResolvedValue(goodBody('M4.FRAC.ADD'));
    for (const tag of ['c1', 'c2']) {
      const { uploadId } = await upload(auth, childId, tag);
      await api.runUploadAnalysis(auth, childId, uploadId);
      await ledgerRows(childId);
    }
    const { uploadId } = await upload(auth, childId, 'c3');
    await expect(api.runUploadAnalysis(auth, childId, uploadId)).rejects.toThrow(/đủ số ảnh/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('withdrawing the consent closes the gate again', async () => {
    fetchMock.mockReset();
    const { auth, childId } = await newChild('withdraw');
    await api.setConsent(auth, childId, 'document_reading', true);
    await api.setConsent(auth, childId, 'document_reading', false);
    const { uploadId } = await upload(auth, childId, 'w');
    await expect(api.runUploadAnalysis(auth, childId, uploadId)).rejects.toThrow(/đồng ý/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
