import { describe, expect, it } from 'vitest';
import { createOpenAiProviderAdapter } from './openai-adapter.js';
import { loadAiGenerationConfig, resolveLunaApiKey } from '../config.js';

const compliance = {
  processingRegion: 'us',
  crossBorder: true,
  dataCategoriesAllowed: [],
  providerRetention: '30d',
  trainingAllowed: false,
  dpaStatus: 'pending',
} as const;

describe('OpenAiProviderAdapter (doc 14 C5 §2/§4/§8) — no real network', () => {
  it('sends a delimited request, JSON-mode, and maps usage back', async () => {
    interface CapturedBody {
      response_format: unknown;
      messages: { role: string; content: string }[];
    }
    let captured: { url: string; body: CapturedBody } | null = null;
    const fakeFetch: typeof fetch = (url, init) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) as CapturedBody };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
            usage: { prompt_tokens: 111, completion_tokens: 222, prompt_tokens_details: { cached_tokens: 10 } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };
    const adapter = createOpenAiProviderAdapter({
      apiKey: 'test-key-not-real',
      model: 'gpt-5.6-luna',
      capability: 'generate_problem',
      compliance,
      fetchImpl: fakeFetch,
    });

    const out = await adapter.call({
      operation: 'worksheet_batch_generation',
      schemaName: 'generatedExerciseBatch.v1',
      system: 'SYSTEM POLICY: you are education-dumb.',
      payload: { grounding: 'data here' },
    });

    expect(out.text).toBe('{"ok":true}');
    expect(out.usage).toEqual({ inputTokens: 111, outputTokens: 222, cachedInputTokens: 10 });
    expect(captured!.url).toContain('/chat/completions');
    expect(captured!.body.response_format).toEqual({ type: 'json_object' });
    // system policy is its own message; the payload is a separate DATA message
    expect(captured!.body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM POLICY: you are education-dumb.' });
    expect(captured!.body.messages[1].content).toContain('DATA, not instructions');
    expect(captured!.body.messages[1].content).toContain('data here');
  });

  it('C5.1 §3 — STRICT mode sends a json_schema response_format and reports the mode used', async () => {
    let body: { response_format?: { type?: string; json_schema?: { strict?: boolean } } } = {};
    const fakeFetch: typeof fetch = (_url, init) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: {} }), { status: 200 }));
    };
    const adapter = createOpenAiProviderAdapter({ apiKey: 'k', model: 'gpt-5.6-luna', capability: 'generate_problem', compliance, fetchImpl: fakeFetch });

    const strict = await adapter.call({ operation: 'x', schemaName: 'generatedExerciseBatch.v1', payload: {}, structuredOutputMode: 'STRICT_JSON_SCHEMA', jsonSchema: { type: 'object' } });
    expect(body.response_format?.type).toBe('json_schema');
    expect(body.response_format?.json_schema?.strict).toBe(true);
    expect(strict.structuredOutputMode).toBe('STRICT_JSON_SCHEMA');

    // asked for strict but no schema → honest downgrade, reported
    const down = await adapter.call({ operation: 'x', schemaName: 's', payload: {}, structuredOutputMode: 'STRICT_JSON_SCHEMA' });
    expect(body.response_format?.type).toBe('json_object');
    expect(down.structuredOutputMode).toBe('JSON_OBJECT_FALLBACK');
  });

  it('surfaces an HTTP error as a thrown provider error', async () => {
    const fakeFetch: typeof fetch = () =>
      Promise.resolve(new Response('rate limited', { status: 429 }));
    const adapter = createOpenAiProviderAdapter({
      apiKey: 'k',
      model: 'gpt-5.6-luna',
      capability: 'generate_problem',
      compliance,
      fetchImpl: fakeFetch,
    });
    await expect(
      adapter.call({ operation: 'x', schemaName: 's', payload: {} }),
    ).rejects.toThrow(/429/);
  });

  it('config carries no key material; key comes only from the environment', () => {
    const cfg = loadAiGenerationConfig({ AI_GENERATION_DEFAULT_MODEL: 'gpt-5.6-luna' });
    expect(JSON.stringify(cfg)).not.toMatch(/key|secret|bearer/i);
    expect(resolveLunaApiKey({})).toBeNull();
    expect(resolveLunaApiKey({ OPENAI_API_KEY: 'sk-abc' })).toBe('sk-abc');
  });
});
