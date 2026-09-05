// OFFLINE FULL RE-SCORE of the 204 raw verification items through the CORRECTED
// validator (doc 62 §5). No paid calls. Reconstructs the deterministic kernels,
// rebuilds a minimal exercise from the saved prompt + worked solution, and runs
// the reconciliation-layer validateAgainstKernel.
//
// LIMITATION: non-kernel gates (similarity / schema / uniqueness / leakage)
// cannot be re-run without the full GeneratedExercise; where the ORIGINAL run
// failed one of those, the item stays rejected (those gates are unchanged here).
//
// node scripts/verify-rescore.mjs

import { readFileSync } from 'node:fs';
import { loadKnowledgeBase } from '../packages/math-data/dist/index.js';
import { loadReferenceLibrary } from '../packages/reference-library/dist/index.js';
import { buildItemBenchmarkSpecs } from '../packages/testing/dist/benchmark/item-generation-benchmark.js';
import { reconstructKernels } from '../packages/exercise-gen/dist/item-orchestrator.js';
import { validateAgainstKernel } from '../packages/exercise-gen/dist/kernel-validator.js';

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const SPEC_IDS = ['BENCH-LT-G4-02', 'BENCH-LT-G4-07', 'BENCH-LT-G7-04', 'BENCH-LT-G7-03', 'HC06', 'HC03'];
const specs = buildItemBenchmarkSpecs(kb).filter((s) => SPEC_IDS.includes(s.id));
const kernelByItem = new Map();
for (const s of specs) for (const [id, k] of reconstructKernels(s.spec, kb, lib)) kernelByItem.set(id, k);

const rawPath = new URL('../docs/implementation/data/61_verification_raw.jsonl', import.meta.url);
const rows = readFileSync(rawPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const NON_KERNEL_GATES = ['SIMILARITY_OK', 'SCHEMA_VALID', 'UNIQUENESS_OK'];
const lastNum = (s) => {
  const m = [...(s || '').replace(/−/g, '-').matchAll(/-?\d+(?:[.,]\d+)?/g)];
  return m.length ? Number(m.at(-1)[0].replace(',', '.')) : null;
};

function answerSpecFor(r, kernel) {
  const m = /answer (\{[^}]+\})/.exec(r.failureDetail || '');
  if (m) { try { return JSON.parse(m[1]); } catch { /* fall through */ } }
  if (kernel) return kernel.expectedAnswer;
  const v = lastNum(r.workedSolution);
  return v == null ? { kind: 'numeric', value: NaN, tolerance: 0 } : { kind: 'numeric', value: v, tolerance: 0 };
}

const models = {};
for (const r of rows) {
  const M = (models[r.model] ??= {
    items: 0, acc: 0, prod: 0, crosscheck: 0, semUnknown: 0, detWrong: 0,
    kernelDrift: 0, answerMismatch: 0, solContra: 0, leakage: 0, dup: 0, sim: 0, schema: 0,
    fpFixed: 0, stillRej: 0, bySpec: {},
  });
  M.items += 1;
  const spec = r.specId;
  const sp = (M.bySpec[spec] ??= { req: 0, prod: 0, kItems: 0, kProd: 0 });
  sp.req += 1;
  const kernel = kernelByItem.get(r.itemId) ?? null;
  if (kernel) sp.kItems += 1;

  const origFailedNonKernel = (r.failedGates || []).some((g) => NON_KERNEL_GATES.includes(g));
  const origDetailNonKernel = /SIMILARITY_OK:|is not a (number|fraction)|hint rung|need a correct answer/.test(r.failureDetail || '');

  // originally accepted → stays accepted (our changes only RELAX the kernel gate)
  if (r.accepted) {
    M.acc += 1;
    if (r.answerStatus === 'CROSSCHECK_REQUIRED') M.crosscheck += 1;
    if (r.productionReady) { M.prod += 1; sp.prod += 1; if (kernel) sp.kProd += 1; }
    continue;
  }

  // rejected — re-adjudicate
  if (origFailedNonKernel || origDetailNonKernel) {
    // a non-kernel gate failed → unchanged, stays rejected
    M.stillRej += 1;
    if (/vs reference/.test(r.failureDetail || '')) M.leakage += 1;
    else if (/near_copy \(1\.00\)|identical \(normalized\)|token_jaccard \(1\.00\)|template_match \(1\.00\)/.test(r.failureDetail || '')) M.dup += 1;
    else if (/SIMILARITY_OK:/.test(r.failureDetail || '')) M.sim += 1;
    else M.schema += 1;
    // BUT: if it ALSO had a kernel FP, note the FP is fixed even though the item still fails
    if (kernel && /kernel contradiction/.test(r.failureDetail || '')) {
      const ex = { prompt: r.prompt || '', workedSolution: r.workedSolution || '', answerSpec: answerSpecFor(r, kernel), answerKind: 'numeric', hints: [], skillId: '', requiredSkillIds: [], bucket: 'currentSkill', knowledgeLevel: 'K2', thinkingLevel: 'T2', id: 'x', generationSpecId: 'g', origin: 'ai_generated' };
      const kv = validateAgainstKernel(ex, kernel);
      if (kv.consistent) M.fpFixed += 1;
    }
    continue;
  }

  // pure kernel rejection → re-run corrected validator
  if (!kernel) { M.stillRej += 1; continue; }
  const ex = { prompt: r.prompt || '', workedSolution: r.workedSolution || '', answerSpec: answerSpecFor(r, kernel), answerKind: kernel.expectedAnswer.kind === 'fraction' ? 'fraction' : 'numeric', hints: [], skillId: '', requiredSkillIds: [], bucket: 'currentSkill', knowledgeLevel: 'K2', thinkingLevel: 'T2', id: 'x', generationSpecId: 'g', origin: 'ai_generated' };
  const kv = validateAgainstKernel(ex, kernel);
  if (kv.consistent) {
    M.acc += 1; M.prod += 1; sp.prod += 1; sp.kProd += 1; M.fpFixed += 1;
  } else if (kv.semanticVerdict === 'UNKNOWN') {
    M.semUnknown += 1; M.stillRej += 1;
  } else {
    M.detWrong += 1; M.stillRej += 1;
    if (kv.codes.includes('ANSWER_MISMATCH')) M.answerMismatch += 1;
    if (kv.codes.includes('SOLUTION_CONTRADICTS_KERNEL')) M.solContra += 1;
    if (kv.codes.includes('SEMANTIC_STRUCTURE_MISMATCH') || kv.codes.includes('KERNEL_NUMBER_DROPPED') || kv.codes.includes('OPERAND_MUTATION')) M.kernelDrift += 1;
  }
}

const CLEAN = { 'gpt-4o-mini': { c: 75.0, p: 67.6 }, 'gpt-4.1-mini': { c: 92.6, p: 85.0 }, 'gpt-5-mini': { c: 92.6, p: 85.0 } };
for (const [model, M] of Object.entries(models)) {
  const pc = (n) => ((n / M.items) * 100).toFixed(1);
  console.log(`\n================ ${model}  (${M.items} items) ================`);
  console.log(`CONTENT accepted:      ${M.acc}  (${pc(M.acc)}%)`);
  console.log(`PRODUCTION-ready:      ${M.prod}  (${pc(M.prod)}%)`);
  console.log(`crosscheck-required:   ${M.crosscheck}`);
  console.log(`SEMANTIC_UNKNOWN:      ${M.semUnknown}   (retry/escalate eligible, NOT wrong)`);
  console.log(`true DETERMINISTIC_WRONG: ${M.detWrong}`);
  console.log(`  - kernel drift (num/semantic): ${M.kernelDrift}`);
  console.log(`  - answer mismatch:             ${M.answerMismatch}`);
  console.log(`  - solution contradiction:      ${M.solContra}`);
  console.log(`still rejected (non-kernel): leakage ${M.leakage}  duplicate ${M.dup}  similarity ${M.sim}  schema ${M.schema}`);
  console.log(`validator false positives ELIMINATED by the fix: ${M.fpFixed}`);
  const c = CLEAN[model];
  console.log(`vs verification-clean estimate: CONTENT ${pc(M.acc)}% vs ${c.c}%  (Δ ${(pc(M.acc) - c.c).toFixed(1)} pp)   PRODUCTION ${pc(M.prod)}% vs ${c.p}%  (Δ ${(pc(M.prod) - c.p).toFixed(1)} pp)`);
  // worksheets
  const sps = Object.values(M.bySpec);
  const full = sps.filter((s) => s.kItems > 0 && s.kProd === s.kItems).length;
  const miss = sps.reduce((a, s) => a + (s.req - s.prod), 0);
  console.log(`full worksheet success (kernel items all production-ready): ${full}/${sps.length}`);
  console.log(`missing items / worksheet: ${(miss / sps.length).toFixed(2)}`);
}
