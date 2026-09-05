// Hand-adjudicated verdicts for the SMALL paid verification (doc 61).
// Each failed item was inspected against its FULL raw prompt + worked solution
// in ROUND2_VERIFY_raw.jsonl. Verdicts:
//   V  = VALIDATOR false positive (known class reappeared / new prose-heuristic FP)
//   M  = TRUE model failure (kept)
//   MX = mixed (model also did something wrong, but a validator FP co-fired)
import { readFileSync } from 'node:fs';

const V = {
  'gpt-5-mini': {
    'egs_LT-G4-02_0::item-08': ['M', 'sibling trigram 0.78 — scenario reuse on a 16-item worksheet'],
    'egs_LT-G4-07_0::item-11': ['M', 'schema: answer "B" (MC letter) for a numeric item'],
    'egs_LT-G7-04_0::item-11': ['M', 'sibling jaccard 0.50 on a bare equation — weak/borderline'],
    'egs_LT-G7-04_0::item-12': ['M', 'true duplicate: near_copy 1.00, normalized-identical to item-08'],
    'egs_LT-G7-04_0::item-13': ['V', 'KERNEL_NUMBER_DROPPED "2": coefficient written as "Hai hộp" (word); valid word problem, answer 4 correct'],
    'egs_LT-G7-04_0::item-14': ['M', 'schema: answer "A" (MC letter) for a numeric item'],
    'egs_LT-G7-04_0::item-16': ['V', 'SEMANTIC_STRUCTURE_MISMATCH: valid word-problem realization "2x + (−1) = 75", answer 38 correct'],
  },
  'gpt-4.1-mini': {
    'egs_LT-G4-02_0::item-04': ['M', 'sibling template_match 1.00'],
    'egs_LT-G4-07_0::item-11': ['M', 'sibling trigram 0.63'],
    'egs_LT-G7-03_0::item-07': ['V', 'OPERAND_MUTATION: answer 3 collides with "3 phần" (part count), not leaked data'],
    'egs_LT-G7-03_0::item-08': ['M', 'sibling trigram 0.69 — ratio-share scenario reuse'],
    'egs_LT-G7-04_0::item-02': ['M', 'sibling trigram 0.70 — ANGLE_SUM phrasing (formulaic type)'],
    'egs_LT-G7-04_0::item-09': ['V', 'SEMANTIC: valid word problem, solution sets up "12x - 10 = 38", answer correct'],
    'egs_LT-G7-04_0::item-11': ['V', 'SEMANTIC: valid word problem "7x - 19 = 16", answer 5 correct'],
    'egs_LT-G7-04_0::item-12': ['V', 'SEMANTIC: word problem "6x + 17 = 41" (weak scenario, right structure) + trigram 0.66'],
    'egs_LT-G7-04_0::item-14': ['MX', 'model changed to a 2-variable setup; "missing 2" also FP ("gấp đôi")'],
    'egs_LT-G7-04_0::item-16': ['V', 'SEMANTIC: "2(x−1) = 75" word problem; kernel 2x−1 vs 2x−2 is a realization ambiguity'],
  },
  'gpt-4o-mini': {
    'egs_hc03_0::item-01': ['M', 'REAL DRIFT: wrote "150 : 5 = 30" (equal division), not the ratio-share; answer 30 ≠ 75'],
    'egs_hc03_0::item-04': ['M', 'sibling trigram 0.60'],
    'egs_LT-G4-02_0::item-04': ['M', 'sibling trigram 0.68'],
    'egs_LT-G4-02_0::item-05': ['M', 'kernel-realization drift: UNIT_RATE wants 28, model built a "28:7=4" prompt; answer 4 ≠ 28'],
    'egs_LT-G4-02_0::item-06': ['M', 'sibling jaccard 0.73'],
    'egs_LT-G4-02_0::item-08': ['M', 'sibling trigram 0.72'],
    'egs_LT-G4-07_0::item-04': ['M', 'REAL DRIFT: inflated operand 24 → 24.000, answer 1.248.000 ≠ kernel'],
    'egs_LT-G4-07_0::item-07': ['M', 'REAL DRIFT: wrote own operands (24,29,13), answer 689 ≠ kernel 1008'],
    'egs_LT-G4-07_0::item-11': ['M', 'REAL DRIFT: ×1000 scale, answer 675000 ≠ 675'],
    'egs_LT-G7-03_0::item-05': ['M', 'true duplicate: token_jaccard 1.00'],
    'egs_LT-G7-04_0::item-02': ['M', 'LEAKAGE: trigram 0.84 vs a reference example'],
    'egs_LT-G7-04_0::item-09': ['M', 'REAL DRIFT: wrote "12 - 10 = 2" trivial subtraction; answer 2, ANSWER_MISMATCH'],
    'egs_LT-G7-04_0::item-11': ['M', 'REAL DRIFT: wrote "7 + 16 = 23" trivial addition; ANSWER_MISMATCH'],
    'egs_LT-G7-04_0::item-12': ['M', 'true duplicate: near_copy 1.00, normalized-identical to item-08'],
    'egs_LT-G7-04_0::item-13': ['M', 'REAL DRIFT: wrote "22 + 2 = 24" trivial addition; ANSWER_MISMATCH'],
    'egs_LT-G7-04_0::item-14': ['MX', 'model set up wrong eq "19 - x = 2x" (got x=10, matches kernel); SEMANTIC also FP'],
    'egs_LT-G7-04_0::item-16': ['M', 'REAL DRIFT: wrote "(75-1)/2 = 37"; answer 37 ≠ kernel 38'],
  },
};

const rows = readFileSync('ROUND2_VERIFY_raw.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const perModel = {};
for (const r of rows) {
  const m = (perModel[r.model] ??= { items: 0, accepted: 0, prod: 0, crosscheck: 0, fp: 0, mx: 0, real: 0,
    fpItems: [], bySpec: {} });
  m.items += 1;
  const sp = (m.bySpec[r.specId] ??= { req: 0, accProd: 0, kernelItems: 0, kernelProd: 0, fpFlip: 0 });
  sp.req += 1;
  if (r.kernelFamily) sp.kernelItems += 1;
  if (r.accepted) {
    m.accepted += 1;
    if (r.answerStatus === 'CROSSCHECK_REQUIRED') m.crosscheck += 1;
    if (r.productionReady) { m.prod += 1; sp.accProd += 1; if (r.kernelFamily) sp.kernelProd += 1; }
  } else {
    const v = V[r.model]?.[r.itemId];
    if (!v) { console.error('UNJUDGED', r.model, r.itemId, r.failureDetail?.slice(0, 80)); m.real += 1; continue; }
    if (v[0] === 'V') { m.fp += 1; m.fpItems.push(`${r.specId}::${r.itemId} — ${v[1]}`); sp.fpFlip += 1; }
    else if (v[0] === 'MX') { m.mx += 1; }
    else m.real += 1;
  }
}

for (const [model, m] of Object.entries(perModel)) {
  const pct = (n) => ((n / m.items) * 100).toFixed(1);
  const corrAcc = m.accepted + m.fp;            // FP items would have passed CONTENT
  const corrProd = m.prod + m.fp;               // and (kernel-supported, answer-correct) production
  console.log(`\n================ ${model}  (${m.items} items) ================`);
  console.log(`as-run:     CONTENT ${m.accepted} (${pct(m.accepted)}%)   PRODUCTION ${m.prod} (${pct(m.prod)}%)   crosscheck-req ${m.crosscheck}   rejected ${m.items - m.accepted}`);
  console.log(`VALIDATOR FALSE POSITIVES (this run): ${m.fp}    mixed: ${m.mx}    true model failures: ${m.real}`);
  for (const f of m.fpItems) console.log(`   V  ${f}`);
  console.log(`corrected:  CONTENT ~${(corrAcc / m.items * 100).toFixed(1)}%   PRODUCTION ~${(corrProd / m.items * 100).toFixed(1)}%   (mixed counted as still-failing)`);
  // worksheets
  const specs = Object.entries(m.bySpec);
  let full = 0, fullCorr = 0, miss = 0, missCorr = 0;
  for (const [, sp] of specs) {
    const ok = sp.kernelItems > 0 && sp.kernelProd === sp.kernelItems;
    const okCorr = sp.kernelItems > 0 && sp.kernelProd + sp.fpFlip >= sp.kernelItems;
    if (ok) full += 1;
    if (okCorr) fullCorr += 1;
    miss += sp.req - sp.accProd;
    missCorr += Math.max(0, sp.req - sp.accProd - sp.fpFlip);
  }
  console.log(`full worksheet success after ≤1 retry: as-run ${full}/${specs.length}  corrected ~${fullCorr}/${specs.length}`);
  console.log(`missing items / worksheet after ≤1 retry: as-run ${(miss / specs.length).toFixed(2)}  corrected ~${(missCorr / specs.length).toFixed(2)}`);
}
