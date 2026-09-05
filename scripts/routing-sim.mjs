// OFFLINE routing-policy simulation (doc 62 §6–§9). No paid calls.
//
// Inputs: the 204 raw verification items (all 3 models ran the SAME 68
// ItemGenerationSpecs), re-scored through the corrected validator. Because every
// model's actual outcome on every item is known, a fallback chain can be walked
// with almost no assumptions — escalation uses the next model's REAL outcome on
// the same spec+kernel.
//
// node scripts/routing-sim.mjs

import { readFileSync } from 'node:fs';
import { loadKnowledgeBase } from '../packages/math-data/dist/index.js';
import { loadReferenceLibrary } from '../packages/reference-library/dist/index.js';
import { buildItemBenchmarkSpecs } from '../packages/testing/dist/benchmark/item-generation-benchmark.js';
import { buildItemGenerationSpecs } from '../packages/exercise-gen/dist/item-spec.js';
import { reconstructKernels } from '../packages/exercise-gen/dist/item-orchestrator.js';
import { validateAgainstKernel } from '../packages/exercise-gen/dist/kernel-validator.js';

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const SPEC_IDS = ['BENCH-LT-G4-02', 'BENCH-LT-G4-07', 'BENCH-LT-G7-04', 'BENCH-LT-G7-03', 'HC06', 'HC03'];
const benchSpecs = buildItemBenchmarkSpecs(kb).filter((s) => SPEC_IDS.includes(s.id));

const kernelByItem = new Map();
const specMetaByItem = new Map();
const worksheetOf = new Map();
for (const s of benchSpecs) {
  for (const [id, k] of reconstructKernels(s.spec, kb, lib)) kernelByItem.set(id, k);
  for (const is of buildItemGenerationSpecs(s.spec, kb)) {
    specMetaByItem.set(is.itemId, { k: is.knowledgeLevel, t: is.thinkingLevel, ps: is.problemStructure, role: is.targetRole });
    worksheetOf.set(is.itemId, s.id);
  }
}

const GROUP_C_STRUCTURES = new Set(['explain_or_justify', 'find_the_error', 'construct_an_example', 'compare_and_decide']);
const rows = JSON.parse('[' + readFileSync(new URL('../docs/implementation/data/61_verification_raw.jsonl', import.meta.url), 'utf8').trim().split('\n').join(',') + ']');

const lastNum = (s) => {
  const m = [...(s || '').replace(/−/g, '-').matchAll(/-?\d+(?:[.,]\d+)?/g)];
  return m.length ? Number(m.at(-1)[0].replace(',', '.')) : null;
};
function answerSpecFor(r, kernel) {
  const m = /answer (\{[^}]+\})/.exec(r.failureDetail || '');
  if (m) { try { return JSON.parse(m[1]); } catch { /* */ } }
  if (kernel) return kernel.expectedAnswer;
  const v = lastNum(r.workedSolution);
  return v == null ? { kind: 'numeric', value: NaN, tolerance: 0 } : { kind: 'numeric', value: v, tolerance: 0 };
}

// corrected per-(model,item) outcome
const NON_KERNEL = ['SIMILARITY_OK', 'SCHEMA_VALID', 'UNIQUENESS_OK'];
const outcome = {}; // outcome[itemId][model] = { state, calls }
for (const r of rows) {
  const kernel = kernelByItem.get(r.itemId) ?? null;
  const meta = specMetaByItem.get(r.itemId);
  const groupC = meta && GROUP_C_STRUCTURES.has(meta.ps);
  (outcome[r.itemId] ??= {});
  let state, calls;

  if (r.accepted) {
    state = r.productionReady ? 'PROD' : (groupC ? 'GROUP_C' : 'CONTENT_ONLY');
    calls = r.attempts;
  } else {
    const nonKernel = (r.failedGates || []).some((g) => NON_KERNEL.includes(g)) ||
      /SIMILARITY_OK:|is not a (number|fraction)|hint rung|need a correct answer/.test(r.failureDetail || '');
    let fpFixed = false;
    if (kernel && /kernel contradiction/.test(r.failureDetail || '') && !nonKernel) {
      const ex = { prompt: r.prompt || '', workedSolution: r.workedSolution || '', answerSpec: answerSpecFor(r, kernel), answerKind: kernel.expectedAnswer.kind === 'fraction' ? 'fraction' : 'numeric', hints: [], skillId: '', requiredSkillIds: [], bucket: 'currentSkill', knowledgeLevel: 'K2', thinkingLevel: 'T2', id: 'x', generationSpecId: 'g', origin: 'ai_generated' };
      const kv = validateAgainstKernel(ex, kernel);
      if (kv.consistent) fpFixed = true;
      else if (kv.semanticVerdict === 'UNKNOWN') { state = 'FAIL_UNKNOWN'; }
    }
    if (fpFixed) { state = 'PROD'; calls = 1; }
    else if (state === 'FAIL_UNKNOWN') { calls = r.attempts; }
    else if (/vs reference/.test(r.failureDetail || '')) { state = 'FAIL_LEAKAGE'; calls = r.attempts; }
    else if (/near_copy \(1\.00\)|identical \(normalized\)|token_jaccard \(1\.00\)|template_match \(1\.00\)/.test(r.failureDetail || '')) { state = 'FAIL_DUP'; calls = r.attempts; }
    else if (/SIMILARITY_OK:/.test(r.failureDetail || '')) { state = 'FAIL_SIM'; calls = r.attempts; }
    else if (/is not a (number|fraction)|hint rung|need a correct answer/.test(r.failureDetail || '')) { state = 'FAIL_SCHEMA'; calls = r.attempts; }
    else { state = 'FAIL_DRIFT'; calls = r.attempts; }
  }
  outcome[r.itemId][r.model] = { state, calls: calls ?? r.attempts, groupC };
}

const COST = { 'gpt-4o-mini': 0.000335, 'gpt-4.1-mini': 0.00104, 'gpt-5-mini': 0.00160 }; // USD / call (verification actuals)
const LAT = { 'gpt-4o-mini': 2064, 'gpt-4.1-mini': 2718, 'gpt-5-mini': 6221 }; // p50 ms / call
const VND = 26000;

const isSimple = (m) => m && m.ps === 'direct_computation' && ['K1', 'K2'].includes(m.k) && ['T1', 'T2'].includes(m.t);

// chain fn: returns ordered list of models to try for an item
const POLICIES = {
  'A (gpt-4.1-mini default → gpt-5-mini)': () => ['gpt-4.1-mini', 'gpt-5-mini'],
  'B (structure routing)': (m) => (isSimple(m)
    ? ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5-mini']
    : ['gpt-4.1-mini', 'gpt-5-mini']),
  'C (gpt-5-mini everywhere)': () => ['gpt-5-mini'],
};

// bounded 2nd-round recovery probabilities for RETRYABLE failure classes
// (a diversity-forcing / format-forcing regeneration on the same model).
const RECOVER = { FAIL_SIM: 0.6, FAIL_DUP: 0.6, FAIL_SCHEMA: 0.8, FAIL_LEAKAGE: 0.5, FAIL_DRIFT: 0.15, FAIL_UNKNOWN: 0.3 };

for (const [name, chainFor] of Object.entries(POLICIES)) {
  for (const withRecovery of [false, true]) {
  let items = 0, prod = 0, contentOnly = 0, groupC = 0, unresolved = 0;
  let calls = 0;
  const share = { 'gpt-4o-mini': 0, 'gpt-4.1-mini': 0, 'gpt-5-mini': 0 };
  let fallbacks = 0;
  let latSum = 0;
  const wsMiss = {}; // worksheet → missing count

  for (const itemId of Object.keys(outcome)) {
    items += 1;
    const meta = specMetaByItem.get(itemId);
    const ws = worksheetOf.get(itemId);
    wsMiss[ws] ??= 0;
    const chain = chainFor(meta);
    let resolved = false;
    let step = 0;
    let lastFailModel = null;
    let lastFailState = null;
    for (const model of chain) {
      step += 1;
      const o = outcome[itemId]?.[model];
      if (!o) continue;
      calls += o.calls;
      share[model] += o.calls;
      latSum += o.calls * LAT[model];
      if (step > 1) fallbacks += 1;
      if (o.state === 'PROD') { prod += 1; resolved = true; break; }
      if (o.state === 'GROUP_C') { groupC += 1; resolved = true; break; }
      if (o.state === 'CONTENT_ONLY') { contentOnly += 1; resolved = true; break; }
      lastFailModel = model;
      lastFailState = o.state; // FAIL_* → escalate to the next model in the chain
    }
    if (!resolved) {
      const isGroupC = outcome[itemId] && Object.values(outcome[itemId]).some((o) => o.groupC);
      if (isGroupC) { groupC += 1; }
      else if (withRecovery && lastFailModel && RECOVER[lastFailState] != null) {
        // one bounded recovery round on the terminal (strongest) model
        calls += 1; share[lastFailModel] += 1; latSum += LAT[lastFailModel];
        const p = RECOVER[lastFailState];
        prod += p;
        unresolved += (1 - p);
        wsMiss[ws] += (1 - p);
      } else {
        unresolved += 1;
        wsMiss[ws] += 1;
      }
    }
  }

  const totalCalls = calls;
  const usd = Object.entries(share).reduce((a, [m, c]) => a + c * COST[m], 0);
  const completed = prod + groupC + contentOnly; // groupC counts as "completed pending crosscheck"
  const wsCount = Object.keys(wsMiss).length;
  const wsFull = Object.values(wsMiss).filter((n) => n === 0).length;
  const pc = (n) => ((n / items) * 100).toFixed(1);

  console.log(`\n================ POLICY ${name}  [${withRecovery ? '+ bounded 2nd-round recovery' : 'chain only, ≤1 retry/model'}] ================`);
  console.log(`items: ${items}`);
  console.log(`  PRODUCTION-ready (deterministic):      ${prod}  (${pc(prod)}%)`);
  console.log(`  content-only (PENDING_CROSSCHECK):     ${contentOnly}`);
  console.log(`  Group C (reasoning → AI_CROSSCHECK):   ${groupC}`);
  console.log(`  UNRESOLVED after full chain:           ${unresolved}  (${pc(unresolved)}%)`);
  console.log(`VALID ITEM COMPLETION RATE (prod + groupC-crosscheck): ${pc(prod + groupC)}%`);
  console.log(`  deterministic-only completion:         ${pc(prod)}%`);
  console.log(`FULL WORKSHEET COMPLETION (0 unresolved kernel slots): ${wsFull}/${wsCount}  (${((wsFull / wsCount) * 100).toFixed(0)}%)`);
  console.log(`avg calls / item:      ${(totalCalls / items).toFixed(2)}`);
  console.log(`avg calls / worksheet: ${(totalCalls / wsCount).toFixed(1)}`);
  console.log(`model call share:  4o-mini ${((share['gpt-4o-mini'] / totalCalls) * 100).toFixed(0)}%  4.1-mini ${((share['gpt-4.1-mini'] / totalCalls) * 100).toFixed(0)}%  5-mini ${((share['gpt-5-mini'] / totalCalls) * 100).toFixed(0)}%`);
  console.log(`fallback rate (items escalated ≥1 step): ${((fallbacks / items) * 100).toFixed(1)}%`);
  console.log(`final unresolved rate: ${pc(unresolved)}%`);
  console.log(`est cost / item:            $${(usd / items).toFixed(5)}  (~${Math.round((usd / items) * VND)} VND)`);
  console.log(`est cost / completed worksheet: $${(usd / wsFull || 0).toFixed(4)}  (~${Math.round((usd / Math.max(1, wsFull)) * VND)} VND)  [${wsFull} completed]`);
  console.log(`est cost / worksheet (all):     $${(usd / wsCount).toFixed(4)}`);
  console.log(`est p50 worksheet latency: ${((latSum / wsCount) / 1000).toFixed(1)} s serial  ·  ~${((latSum / wsCount) / 1000 / 4).toFixed(1)} s at concurrency 4`);
  }
}
