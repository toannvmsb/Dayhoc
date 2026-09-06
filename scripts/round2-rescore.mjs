// Deterministic RE-CLASSIFICATION of Round 2 failed items against the CURRENT
// (doc 59 P0 + P1) validator logic.
//
// LIMITATION: raw model outputs (prompt + worked solution) were NOT persisted by
// the Round 2 harness — the ROUND2_raw.jsonl sidecar was added in commit 2aa3579
// AFTER Round 2 ran. This is therefore NOT a full pipeline re-score; it is a
// rule-based reclassification of each failed item's recorded failure detail,
// deciding whether the fixed validator would still flag it. Items that cannot be
// resolved from the detail alone are marked UNRESOLVED_NEEDS_RERUN.
//
// Usage: node scripts/round2-rescore.mjs

import { readFileSync } from 'node:fs';

const FILES = [
  { path: 'ROUND2_m12.txt', models: ['gpt-4o-mini', 'gpt-4.1-mini'] },
  { path: 'ROUND2.txt', models: ['gpt-5-mini'] },
];

/** parse "================ <model>  (n/m specs) ================" section headers + failed-item blocks */
function parse(path) {
  const raw = readFileSync(path, 'utf8').split('\n');
  const _out = [];
  let model = null;
  let _requested = null;
  const perModel = {};
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i];
    const mh = line.match(/^=+ (\S+)\s+\((\d+)\/\d+ specs\) =+$/);
    if (mh) {
      model = mh[1];
      perModel[model] = { requested: null, failed: [] };
      continue;
    }
    const rq = line.match(/^\s*requested items:\s*(\d+)/) || line.match(/requested items:\s*(\d+)/);
    if (rq && model) perModel[model].requested = Number(rq[1]);
    const fi = line.match(/^ {2}- (\S+) \[([A-Z_]+)\] k=(\S+) gates=\[([^\]]*)\]$/);
    if (fi && model) {
      const detail = (raw[i + 1] || '').trim();
      perModel[model].failed.push({
        id: fi[1],
        oldCat: fi[2],
        kernel: fi[3],
        gates: fi[4] ? fi[4].split(',') : [],
        detail,
      });
    }
  }
  return perModel;
}

const CATS = [
  'TRUE_MODEL_CONTENT',
  'TRUE_MODEL_KERNEL_DRIFT',
  'TRUE_MODEL_SCHEMA',
  'TRUE_LEAKAGE',
  'TRUE_DUPLICATE',
  'VALIDATOR_FALSE_POSITIVE',
  'KERNEL_DEFECT',
  'INFRA',
  'UNRESOLVED_NEEDS_RERUN',
  'OTHER',
];

function _numsIn(s) {
  return [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** decide the corrected category + whether the CURRENT validator would still flag it */
function reclassify(f) {
  const d = f.detail;

  // --- similarity gate (unchanged by P0/P1) ---
  if (/SIMILARITY_OK:/.test(d)) {
    if (/near_copy \(1\.00\)|identical \(normalized\)|token_jaccard \(1\.00\)/.test(d)) {
      return { cat: 'TRUE_DUPLICATE', stillFails: true };
    }
    if (/vs reference/.test(d)) return { cat: 'TRUE_LEAKAGE', stillFails: true };
    if (/vs worksheet_sibling/.test(d)) return { cat: 'TRUE_MODEL_CONTENT', stillFails: true };
  }

  // --- schema / compose (unchanged) ---
  if (f.gates.includes('SCHEMA_VALID') || /is not a (number|fraction)|hint rung|need a correct answer/.test(d)) {
    return { cat: 'TRUE_MODEL_SCHEMA', stillFails: true };
  }

  // --- kernel contradiction detail ---
  const hasKC = /kernel contradiction \[([A-Z_,]+)\]/.exec(d);
  if (hasKC) {
    const codes = hasKC[1].split(',');

    // KERNEL_NUMBER_DROPPED with a negative "missing" number → P1 fixed (abs match)
    const missNeg = /missing given number\(s\):\s*(-\d+)/.exec(d);
    const missPos = /missing given number\(s\):\s*(\d[\d,\s]*)/.exec(d);

    // SEMANTIC_STRUCTURE_MISMATCH on SOLVE_EQUATION → P1 fixed (equation-shape)
    const solveEqSemantic = /operation is SOLVE_EQUATION but the prose reads as/.test(d);

    // SOLUTION_CONTRADICTS_KERNEL "concludes X, kernel answer is Y"
    const concl = /concludes (-?\d+(?:\.\d+)?), kernel answer is (-?\d+(?:\.\d+)?)/.exec(d);
    const never = /never states the correct result (-?\d+)/.exec(d);

    // ANSWER_MISMATCH value X vs kernel Y  (×1000 formatting is a real model error)
    const am = /answer \{"kind":"numeric","value":(-?\d+(?:\.\d+)?)[^}]*\} ≠ kernel \{"kind":"[^"]+","value":(-?\d+(?:\.\d+)?)/.exec(d);

    const only = (set) => codes.every((c) => set.includes(c));

    // pure negative-drop / pure solveEq-semantic → validator false positive now gone
    if (only(['KERNEL_NUMBER_DROPPED', 'SEMANTIC_STRUCTURE_MISMATCH', 'PROMPT_NOT_SOLVABLE']) && (missNeg || solveEqSemantic)) {
      return { cat: 'VALIDATOR_FALSE_POSITIVE', stillFails: false, note: 'P1: LINEAR_EQ negative constant / equation-shape' };
    }
    if (only(['SEMANTIC_STRUCTURE_MISMATCH']) && solveEqSemantic) {
      return { cat: 'VALIDATOR_FALSE_POSITIVE', stillFails: false, note: 'P1: SOLVE_EQUATION equation-shape' };
    }
    if (only(['KERNEL_NUMBER_DROPPED']) && missNeg && !missPos) {
      return { cat: 'VALIDATOR_FALSE_POSITIVE', stillFails: false, note: 'P1: negative constant as subtraction' };
    }

    // ×1000 / ×10000 answer formatting — a REAL model error, unchanged
    if (am) {
      const [x, y] = [Number(am[1]), Number(am[2])];
      if (y !== 0 && (x === y * 1000 || x === y * 10000 || x === y * 100)) {
        return { cat: 'TRUE_MODEL_KERNEL_DRIFT', stillFails: true, note: 'answer stated in thousands (real)' };
      }
      return { cat: 'TRUE_MODEL_KERNEL_DRIFT', stillFails: true, note: 'answer mismatch (real)' };
    }

    // SOLUTION_CONTRADICTS_KERNEL "concludes X"
    if (concl) {
      const [x, y] = [Math.abs(Number(concl[1])), Math.abs(Number(concl[2]))];
      // old extractor grabbed an operand: X is a clean factor of Y (or vice-versa),
      // or Y/X is a small plausible operand → the true answer Y was almost certainly
      // stated later in the solution → FALSE POSITIVE now removed
      const ratio = y > x ? y / x : x / y;
      const cleanFactor = (y % x === 0 && x > 1 && y / x <= 200) || (x % y === 0 && y > 1 && x / y <= 200);
      const plausibleOperand = Number.isInteger(ratio) && ratio >= 2 && ratio <= 100;
      if (cleanFactor || plausibleOperand) {
        return { cat: 'VALIDATOR_FALSE_POSITIVE', stillFails: false, note: `P0: "${concl[1]}" is an operand of ${concl[2]}` };
      }
      // no clean relationship — cannot tell drift from a genuine wrong conclusion
      // without the solution text
      return { cat: 'UNRESOLVED_NEEDS_RERUN', stillFails: null, note: `concludes ${concl[1]} vs ${concl[2]} — needs solution text` };
    }

    if (never) {
      // "never states Y" — could be a real gap OR a thousands-separator split
      // ("1 536") OR the old bug. Not resolvable from the detail.
      return { cat: 'UNRESOLVED_NEEDS_RERUN', stillFails: null, note: `"never states ${never[1]}" — needs solution text` };
    }

    // positive missing number(s) — a real drop unless it is a ratio "1, 1"
    if (missPos && !missNeg) {
      if (/missing given number\(s\):\s*1,\s*1/.test(d)) {
        return { cat: 'UNRESOLVED_NEEDS_RERUN', stillFails: null, note: 'ratio 1:1 rendered without digits — needs prompt text' };
      }
      return { cat: 'TRUE_MODEL_KERNEL_DRIFT', stillFails: true, note: 'given number genuinely dropped' };
    }

    // SEMANTIC_STRUCTURE_MISMATCH on a non-SOLVE_EQUATION op (PROPORTION/ADDITION…) —
    // validator unchanged here → still flags
    if (codes.includes('SEMANTIC_STRUCTURE_MISMATCH')) {
      return { cat: 'TRUE_MODEL_KERNEL_DRIFT', stillFails: true, note: 'operation semantics (non-SOLVE_EQ, unchanged)' };
    }
    if (codes.includes('OPERAND_MUTATION')) {
      return { cat: 'TRUE_MODEL_KERNEL_DRIFT', stillFails: true, note: 'operand mutation (unchanged)' };
    }
    return { cat: 'UNRESOLVED_NEEDS_RERUN', stillFails: null, note: d.slice(0, 80) };
  }

  return { cat: 'OTHER', stillFails: true, note: d.slice(0, 80) };
}

// ---- run ----
const report = {};
for (const { path } of FILES) {
  const parsed = parse(path);
  for (const [model, m] of Object.entries(parsed)) {
    const tally = Object.fromEntries(CATS.map((c) => [c, 0]));
    let nowPasses = 0;
    const lines = [];
    for (const f of m.failed) {
      const r = reclassify(f);
      tally[r.cat] += 1;
      if (r.stillFails === false) nowPasses += 1;
      lines.push(`  ${f.id}  [${f.oldCat} -> ${r.cat}]  ${r.stillFails === false ? 'NOW PASSES' : r.stillFails === null ? 'UNRESOLVED' : 'still fails'}  — ${r.note ?? ''}`);
    }
    // per-spec: a worksheet is "clean after retry" if NONE of its recorded
    // failures still fail under the fixed validator.
    const bySpec = {};
    for (const f of m.failed) {
      const spec = f.id.split('::')[0];
      const r = reclassify(f);
      (bySpec[spec] ??= []).push(r.stillFails !== false); // true = still blocks
    }
    const dirtySpecsAsRun = Object.keys(bySpec).length;
    const dirtySpecsFixed = Object.values(bySpec).filter((arr) => arr.some(Boolean)).length;
    report[model] = {
      requested: m.requested, failedCount: m.failed.length, tally, nowPasses, lines,
      dirtySpecsAsRun, dirtySpecsFixed,
    };
  }
}

for (const [model, r] of Object.entries(report)) {
  console.log(`\n================ ${model} ================`);
  console.log(`requested items: ${r.requested}   recorded failures: ${r.failedCount}`);
  console.log(`failures that the FIXED validator would NO LONGER flag: ${r.nowPasses}`);
  console.log(`old-validator false-positive rate (of recorded failures): ${((r.nowPasses / r.failedCount) * 100).toFixed(1)}%`);
  const fpOfAll = (r.nowPasses / r.requested) * 100;
  console.log(`  = ${fpOfAll.toFixed(1)} percentage points of the item base wrongly rejected`);
  console.log(`worksheets with >=1 recorded failure: as-run ${r.dirtySpecsAsRun}  ->  after fix, still-dirty ${r.dirtySpecsFixed}  (cleaned ${r.dirtySpecsAsRun - r.dirtySpecsFixed})`);
  console.log('corrected taxonomy:');
  for (const [c, n] of Object.entries(r.tally)) if (n) console.log(`  ${c.padEnd(26)} ${n}`);
  console.log('per-item:');
  for (const l of r.lines) console.log(l);
}

// machine-readable summary
console.log('\n---JSON---');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { requested: v.requested, failedCount: v.failedCount, nowPasses: v.nowPasses, tally: v.tally }])), null, 2));
