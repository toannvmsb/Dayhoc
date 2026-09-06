import { describe, expect, it } from 'vitest';
import type { AIProviderAdapter, StructuredAIInput, StructuredAIOutput } from '@copilot/ai';
import { asSkillId, type GeneratedExercise } from '@copilot/domain';
import { createOpenAiAnswerCrosscheck } from './openai-answer-crosscheck.js';
import { runGroupCCrosscheck, toCrosscheckRequest } from './answer-crosscheck.js';

/** doc 66 §5 — paid answer-crosscheck adapter, offline (mock AIProviderAdapter). */

function mockAdapter(reply: (i: StructuredAIInput) => string, model = 'gpt-4.1-mini'): AIProviderAdapter {
  let calls = 0;
  return {
    capability: 'advanced_verification',
    model,
    provider: 'openai',
    processingRegion: 'test',
    crossBorder: true,
    dataCategoriesAllowed: [],
    providerRetention: 'test',
    trainingAllowed: false,
    dpaStatus: 'not_applicable',
    call(input: StructuredAIInput): Promise<StructuredAIOutput> {
      calls += 1;
      return Promise.resolve({
        text: reply(input),
        usage: { inputTokens: 200 + calls, outputTokens: 40 },
        structuredOutputMode: 'STRICT_JSON_SCHEMA',
      });
    },
  };
}

const reasoningItem: GeneratedExercise = {
  id: 'x', generationSpecId: 'g', skillId: asSkillId('M4.ALG.DIST'),
  requiredSkillIds: [asSkillId('M4.ALG.DIST')], bucket: 'thinkingChallenge',
  knowledgeLevel: 'K2', thinkingLevel: 'T4',
  prompt: 'Chứng minh rằng 7 × (12 + 19) = 7 × 12 + 7 × 19.',
  answerSpec: { kind: 'reasoning' },
  hints: ['a', 'b', 'c', 'd', 'e', 'f'],
  workedSolution: '7 × 31 = 217; 84 + 133 = 217; hai vế bằng nhau.',
  rubric: 'Nêu tính chất 0,5đ; tính đủ hai vế 0,5đ.',
  origin: 'ai_generated',
};

describe('createOpenAiAnswerCrosscheck', () => {
  it('parses a PASS verdict + returns usage', async () => {
    const cc = createOpenAiAnswerCrosscheck(mockAdapter(() => '{"verdict":"PASS","confidence":0.9,"reason":"ok"}'));
    const out = await cc.crosscheck(toCrosscheckRequest(reasoningItem, 4));
    expect(out.verdict).toBe('PASS');
    expect(out.usage?.model).toBe('gpt-4.1-mini');
    expect(out.usage?.inputTokens).toBeGreaterThan(0);
  });

  it('an unparseable response is UNCERTAIN, never PASS', async () => {
    const cc = createOpenAiAnswerCrosscheck(mockAdapter(() => 'the answer looks right to me'));
    expect((await cc.crosscheck(toCrosscheckRequest(reasoningItem, 4))).verdict).toBe('UNCERTAIN');
  });

  it('a provider throw is UNCERTAIN', async () => {
    const cc = createOpenAiAnswerCrosscheck({
      ...mockAdapter(() => ''),
      call: () => Promise.reject(new Error('429')),
    });
    const out = await cc.crosscheck(toCrosscheckRequest(reasoningItem, 4));
    expect(out.verdict).toBe('UNCERTAIN');
    expect(out.detail).toMatch(/provider error/);
  });

  it('runGroupCCrosscheck retries once on UNCERTAIN, then routes to review queue', async () => {
    let n = 0;
    const cc = createOpenAiAnswerCrosscheck(
      mockAdapter(() => (++n <= 2 ? '{"verdict":"UNCERTAIN","confidence":0.2,"reason":"mơ hồ"}' : '{"verdict":"PASS"}')),
    );
    const r = await runGroupCCrosscheck(reasoningItem, 4, cc);
    expect(n).toBe(2); // one retry
    expect(r.state).toBe('REVIEW_QUEUE');
    expect(r.usages).toHaveLength(2);
  });

  it('FAIL → REGENERATE (no retry)', async () => {
    const cc = createOpenAiAnswerCrosscheck(mockAdapter(() => '{"verdict":"FAIL","confidence":0.8,"reason":"sai"}'));
    const r = await runGroupCCrosscheck(reasoningItem, 4, cc);
    expect(r.state).toBe('REGENERATE');
    expect(r.usages).toHaveLength(1);
  });

  it('the verifier never sees hints / rubric — only prompt + answer + short solution', async () => {
    let seen: unknown;
    const cc = createOpenAiAnswerCrosscheck(mockAdapter((i) => { seen = i.payload; return '{"verdict":"PASS"}'; }));
    await cc.crosscheck(toCrosscheckRequest(reasoningItem, 4));
    const json = JSON.stringify(seen);
    expect(json).not.toMatch(/Nêu tính chất/); // the actual rubric text is NOT sent
    expect(json).not.toMatch(/"a","b","c"/); // hints are NOT sent
    expect(json).toMatch(/Chứng minh/); // the prompt is there
  });
});
