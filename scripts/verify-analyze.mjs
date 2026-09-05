// Analysis of the SMALL paid verification (doc 60 §8). Consumes the FULL raw
// sidecar ROUND2_VERIFY_raw.jsonl (prompt + worked solution per item) — this IS
// a real re-score, not a reclassification.
//
// Usage: node scripts/verify-analyze.mjs

import { readFileSync } from 'node:fs';

const RAW = 'ROUND2_VERIFY_raw.jsonl';
const rows = readFileSync(RAW, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// known validator-FP fingerprints from Round 2 (doc 59 P0 / P1)
function fpKind(detail) {
  if (!detail) return null;
  const concl = /concludes (-?\d+(?:\.\d+)?), kernel answer is (-?\d+(?:\.\d+)?)/.exec(detail);
  if (concl && /SOLUTION_CONTRADICTS_KERNEL/.test(detail)) {
    const x = Math.abs(+concl[1]);
    const y = Math.abs(+concl[2]);
    const clean = (y % x === 0 && x > 1) || (x % y === 0 && y > 1);
    return clean ? 'SOLUTION_CONTRADICTS_KERNEL_operand_grab' : null;
  }
  if (/missing given number\(s\):\s*-\d/.test(detail) && /KERNEL_NUMBER_DROPPED/.test(detail)) {
    return 'LINEAR_EQ_signed_constant';
  }
  if (/operation is SOLVE_EQUATION but the prose reads as/.test(detail)) return 'SOLVE_EQUATION_semantic';
  return null;
}

const byModel = {};
for (const r of rows) {
  const m = (byModel[r.model] ??= {
    items: 0, accepted: 0, prodReady: 0, crosscheck: 0, rejected: 0,
    firstPassAccepted: 0, firstPassProd: 0,
    fp: [], trueDrift: [], answerMismatch: [], semanticMismatch: [], solContra: [],
    schema: [], leakage: [], dupSibling: [], other: [],
    bySpec: {},
  });
  m.items += 1;
  (m.bySpec[r.specId] ??= { req: 0, accepted: 0, prod: 0, kernelItems: 0, kernelProd: 0 });
  const sp = m.bySpec[r.specId];
  sp.req += 1;
  if (r.kernelFamily) sp.kernelItems += 1;

  if (r.accepted) {
    m.accepted += 1;
    if (r.attempts <= 1) m.firstPassAccepted += 1;
    sp.accepted += 1;
    if (r.answerStatus === 'CROSSCHECK_REQUIRED') m.crosscheck += 1;
    if (r.productionReady) {
      m.prodReady += 1;
      sp.prod += 1;
      if (r.kernelFamily) sp.kernelProd += 1;
      if (r.attempts <= 1) m.firstPassProd += 1;
    }
  } else {
    m.rejected += 1;
    const fk = fpKind(r.failureDetail);
    const g = r.failedGates || [];
    if (fk) m.fp.push({ id: `${r.specId}::${r.itemId}`, fk, detail: r.failureDetail });
    else if (/vs reference/.test(r.failureDetail || '')) m.leakage.push(`${r.specId}::${r.itemId}`);
    else if (/near_copy \(1\.00\)|identical \(normalized\)|token_jaccard \(1\.00\)/.test(r.failureDetail || '')) m.dupSibling.push(`${r.specId}::${r.itemId}`);
    else if (/vs worksheet_sibling/.test(r.failureDetail || '')) m.dupSibling.push(`${r.specId}::${r.itemId}`);
    else if (g.includes('SCHEMA_VALID') || /is not a (number|fraction)|hint rung/.test(r.failureDetail || '')) m.schema.push(`${r.specId}::${r.itemId}`);
    else if (/ANSWER_MISMATCH/.test(r.failureDetail || '')) m.answerMismatch.push(`${r.specId}::${r.itemId}: ${r.failureDetail?.slice(0, 120)}`);
    else if (/SEMANTIC_STRUCTURE_MISMATCH/.test(r.failureDetail || '')) m.semanticMismatch.push(`${r.specId}::${r.itemId}: ${r.failureDetail?.slice(0, 120)}`);
    else if (/SOLUTION_CONTRADICTS_KERNEL/.test(r.failureDetail || '')) m.solContra.push(`${r.specId}::${r.itemId}: ${r.failureDetail?.slice(0, 140)}`);
    else m.other.push(`${r.specId}::${r.itemId} [${g.join(',')}]: ${r.failureDetail?.slice(0, 120)}`);
    if (/SOLUTION_CONTRADICTS_KERNEL|ANSWER_MISMATCH|SEMANTIC_STRUCTURE_MISMATCH|KERNEL_NUMBER_DROPPED|OPERAND_MUTATION/.test(r.failureDetail || '') && !fk) {
      m.trueDrift.push(`${r.specId}::${r.itemId}`);
    }
  }
}

const CLEAN = {
  'gpt-4o-mini': { contentRetry: 80.4, prodRetry: 68.5, rejected: 19.6 },
  'gpt-4.1-mini': { contentRetry: 87.7, prodRetry: 76.2, rejected: 12.3 },
  'gpt-5-mini': { contentRetry: 92.2, prodRetry: 80.3, rejected: 7.8 },
};

let anyFp = false;
for (const [model, m] of Object.entries(byModel)) {
  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : 'n/a');
  console.log(`\n================ ${model} ================`);
  console.log(`items: ${m.items}   accepted(content): ${m.accepted} (${pct(m.accepted, m.items)}%)   production-ready: ${m.prodReady} (${pct(m.prodReady, m.items)}%)   crosscheck-req: ${m.crosscheck}   rejected: ${m.rejected} (${pct(m.rejected, m.items)}%)`);
  console.log(`first-pass content: ${pct(m.firstPassAccepted, m.items)}%   first-pass production: ${pct(m.firstPassProd, m.items)}%`);
  console.log(`KNOWN VALIDATOR FALSE POSITIVES REAPPEARED: ${m.fp.length}`);
  for (const f of m.fp) { anyFp = true; console.log(`   !! ${f.id}  [${f.fk}]  ${f.detail}`); }
  console.log(`true kernel drift: ${m.trueDrift.length}`);
  console.log(`  answer mismatch:        ${m.answerMismatch.length}  ${m.answerMismatch.join(' | ')}`);
  console.log(`  semantic mismatch:      ${m.semanticMismatch.length}  ${m.semanticMismatch.join(' | ')}`);
  console.log(`  solution contradiction: ${m.solContra.length}  ${m.solContra.join(' | ')}`);
  console.log(`  schema:                 ${m.schema.length}  ${m.schema.join(' | ')}`);
  console.log(`  leakage(vs ref):        ${m.leakage.length}  ${m.leakage.join(' | ')}`);
  console.log(`  sibling dup:            ${m.dupSibling.length}  ${m.dupSibling.join(' | ')}`);
  console.log(`  other:                  ${m.other.length}  ${m.other.join(' | ')}`);

  // worksheet metrics
  const specs = Object.entries(m.bySpec);
  let wsFirst = 0, wsRetry = 0;
  let missSum = 0;
  console.log(`worksheets:`);
  for (const [sid, sp] of specs) {
    const missing = sp.req - sp.prod;
    missSum += missing;
    const full = sp.kernelItems > 0 && sp.kernelProd === sp.kernelItems;
    if (full) wsRetry += 1;
    console.log(`  ${sid}: req ${sp.req}  prod-ready ${sp.prod}  missing ${missing}  (kernel ${sp.kernelProd}/${sp.kernelItems})  ${full ? 'FULL' : ''}`);
  }
  console.log(`full worksheet success (after <=1 retry): ${wsRetry}/${specs.length} = ${pct(wsRetry, specs.length)}%`);
  console.log(`MISSING ITEMS PER WORKSHEET (after <=1 retry): total ${missSum} over ${specs.length} worksheets = ${(missSum / specs.length).toFixed(2)} avg`);

  // compare to clean re-score
  const c = CLEAN[model];
  if (c) {
    const contentRetry = (m.accepted / m.items) * 100;
    const prodRetry = (m.prodReady / m.items) * 100;
    const rej = (m.rejected / m.items) * 100;
    console.log(`vs CLEAN RE-SCORE estimate:`);
    console.log(`  CONTENT after retry:     verify ${contentRetry.toFixed(1)}%  vs clean ${c.contentRetry}%   Δ ${(contentRetry - c.contentRetry).toFixed(1)} pp`);
    console.log(`  PRODUCTION after retry:  verify ${prodRetry.toFixed(1)}%  vs clean ${c.prodRetry}%   Δ ${(prodRetry - c.prodRetry).toFixed(1)} pp`);
    console.log(`  rejected:                verify ${rej.toFixed(1)}%  vs clean ${c.rejected}%   Δ ${(rej - c.rejected).toFixed(1)} pp`);
  }
}

console.log(`\n\nANY KNOWN VALIDATOR FALSE POSITIVE REAPPEARED: ${anyFp ? 'YES — STOP, classify as VALIDATOR' : 'NO'}`);
