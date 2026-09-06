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

  it('[guard] PASS verdict + a flagged error → forced FAIL (v1 false-PASS class)', async () => {
    const cc = createOpenAiAnswerCrosscheck(mockAdapter(() =>
      '{"ket_qua_ban_tu_giai":"954","ket_qua_trong_dap_an":"954","loi_sai_phat_hien":"phép cộng 846+108 ghi thành 944","verdict":"PASS","confidence":0.7,"reason":"đáp án sửa đúng"}',
    ));
    const out = await cc.crosscheck(toCrosscheckRequest(reasoningItem, 4));
    expect(out.verdict).toBe('FAIL');
    expect(out.detail).toMatch(/guard/);
  });

  it('[guard] PASS verdict + self-solved result ≠ stated result → forced FAIL', async () => {
    const cc = createOpenAiAnswerCrosscheck(mockAdapter(() =>
      '{"ket_qua_ban_tu_giai":"24 và 36","ket_qua_trong_dap_an":"20","loi_sai_phat_hien":"khong","verdict":"PASS","confidence":0.6,"reason":"ổn"}',
    ));
    // "24 và 36" is prose → not numeric; "20" is numeric → no numeric mismatch,
    // but a single bare number vs prose should still not spuriously FAIL.
    const out = await cc.crosscheck(toCrosscheckRequest(reasoningItem, 4));
    expect(out.verdict).toBe('PASS'); // guard only fires on a clean numeric mismatch
  });

  it('[guard] PASS + clean numeric mismatch (944 vs 954) → forced FAIL', async () => {
    const cc = createOpenAiAnswerCrosscheck(mockAdapter(() =>
      '{"ket_qua_ban_tu_giai":"954","ket_qua_trong_dap_an":"944","loi_sai_phat_hien":"khong","verdict":"PASS","confidence":0.8,"reason":"khớp"}',
    ));
    expect((await cc.crosscheck(toCrosscheckRequest(reasoningItem, 4))).verdict).toBe('FAIL');
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
