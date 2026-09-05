# 62 — VALIDATOR SEMANTIC NORMALIZATION + RECOVERY ROUTING SIMULATION

> 2026-09-06. FREE phase — **no paid generation**. Cleans the residual validator
> false positives from doc 61 with a bounded deterministic reconciliation layer,
> re-scores the 204 saved verification items offline, and simulates the
> production recovery pipeline / routing policies.

---

## A. SEMANTIC-NORMALIZER CHANGES

Hard gates were **not** blindly downgraded. Instead a bounded, deterministic
**reconciliation layer** now sits in `validateAgainstKernel` (doc 62 §1–§3).

### A1. `packages/exercise-gen/src/semantic-normalizer.ts` (NEW) — `semantic-normalizer.v1`

Bounded Vietnamese equivalences, every one with an explicit test:

| category | supported | function |
|---|---|---|
| number words | một→1 … hai mươi→20 (incl. mốt/tư/lăm/bảy variants) | `wordNumbers`, `numberPresent` |
| multiplicative | gấp đôi→×2, gấp ba→×3, gấp N lần→×N (digit or word) | `multiplierPhrases` |
| fraction/share | một nửa→÷2, một phần N→÷N | `fractionPhraseDivisors` |
| signed | giảm N / bớt N / trừ đi / ít hơn / loại bỏ / lỗi → −N | `SIGNED_DOWN_RE` in `numberPresent` |
| equation form | `<a>x ± <b> = <c>`, `<a>(x ± k) = c`, final `x = <v>` | `equationsIn`, `statedUnknown`, `reconcileEquationForm` |
| structural collision | answer value == "N phần/nhóm/đội/tổ" count | `reconcileOperandCollision` |

NOT general NLP. Anything outside these patterns returns **UNKNOWN**, never a
silent PASS.

### A2. Three-way result (`KernelConsistencyResult.semanticVerdict: PASS | FAIL | UNKNOWN`)

`validateAgainstKernel` (`kernel-validator.v3`) now splits codes:

- **HARD** (always a contradiction → `DETERMINISTIC_WRONG`): `ANSWER_MISMATCH`,
  `SOLUTION_CONTRADICTS_KERNEL`, `DISTRACTOR_INCLUDES_ANSWER`, `UNIT_INCONSISTENT`,
  `PROMPT_NOT_SOLVABLE`.
- **RECONCILABLE** — run through the normalizer:
  - `KERNEL_NUMBER_DROPPED` → `reconcileNumberDrop`: every missing number
    recoverable as digit / word / signed / multiplier → drop the code; any
    genuinely absent → **FAIL**.
  - `SEMANTIC_STRUCTURE_MISMATCH` on SOLVE_EQUATION → `reconcileEquationForm`:
    PASS (worked solution sets up the kernel equation or reaches the kernel x) /
    FAIL (sets up a *different* equation → different x) / UNKNOWN.
  - `OPERAND_MUTATION` → `reconcileOperandCollision`: PASS if the value is a
    structural count in the prompt, else FAIL.
  - `SEMANTIC_STRUCTURE_MISMATCH` on a non-SOLVE_EQUATION op keeps the existing
    conservative arithmetic-conflict check (unchanged — it is already precise).

### A3. Policy (doc 62 §3)

- **FAIL** → hard reject (`DETERMINISTIC_WRONG`), regenerate the slot.
- **UNKNOWN** → new answer status `SEMANTIC_UNKNOWN`: **not accepted**, but
  retry / escalation eligible — the item is NOT branded a wrong answer.
  (`ITEM_ANSWER_STATUSES` gains `SEMANTIC_UNKNOWN`; `item-metrics` gains
  `semanticUnknownRate`.)
- **PASS** → the reconciled findings are reported (`kv.reconciled`) and do not block.

### A4. `reconstructKernels(spec, kb, refLib)` exported from `item-orchestrator`

Deterministically rebuilds the `itemId → MathKernel` map exactly as a live run
does — lets an offline re-score / audit reconstruct the kernels a past run used.

---

## B. REGRESSION RESULTS

| check | result |
|---|---|
| full unit suite (`vitest run`) | **735 pass / 44 skip / 0 fail** |
| new: `semantic-normalizer.test.ts` | 18 tests — number words, multipliers, `numberPresent`, `reconcileEquationForm` (incl. the gpt-4.1-mini word-problem FP), `reconcileOperandCollision` (incl. the "3 phần" FP) |
| new: `kernel-integrity.test.ts` doc-62 block | +4 — reconciled findings don't block, a different equation is FAIL, `semanticVerdict` surfaced |
| kernel integrity gate (7000 kernel instances vs oracle) | still 100%, 0 mismatch |
| mock kernel-coverage benchmark (full validator, offline) | kernelSupportedProduction 100%, deterministicWrong 0%, **semanticUnknown 0%**, schema/curriculum/prereq 100% — no regression |
| typecheck web / mobile | clean / clean |

---

## C. CLEAN RE-SCORED MODEL METRICS

Offline re-score: reconstruct the 68 deterministic kernels for the 6 verification
specs, rebuild a minimal exercise from each saved prompt + worked solution, run
`validateAgainstKernel` (v3). Non-kernel gates (similarity / schema / uniqueness /
leakage) are unchanged, so where the original run failed one of those the item
stays rejected. (`scripts/verify-rescore.mjs`.)

| | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| items | 68 | 68 | 68 |
| **CONTENT accepted** | **75.0%** (51) | **91.2%** (62) | **92.6%** (63) |
| **PRODUCTION-ready** | **67.6%** (46) | **83.8%** (57) | **85.3%** (58) |
| crosscheck-required (reasoning) | 5 | 5 | 5 |
| **SEMANTIC_UNKNOWN** | 0 | 0 | 0 |
| **true `DETERMINISTIC_WRONG`** | **7** | **1** | **0** |
| — answer mismatch | 4 | 0 | 0 |
| — solution contradiction | 5 | 0 | 0 |
| — kernel number/semantic | 6 | 1 | 0 |
| still rejected — leakage / dup / similarity / schema | 1 / 2 / 7 / 0 | 0 / 1 / 4 / 0 | 0 / 1 / 2 / 2 |
| **validator FPs eliminated by the fix** | 0 | 5 | 2 |
| vs doc 61 hand-adjudication (CONTENT) | 75.0% (Δ 0.0) | 92.6% (Δ −1.4) | 92.6% (Δ 0.0) |

- **gpt-4o-mini**: the fix eliminates **zero** of its failures — they are all real
  (drift, duplication, leakage). Even on the "simple" subset (direct_computation +
  K1–K2 + T1–T2, n=16) it is **12/16** vs 14/16 (4.1-mini) and 15/16 (5-mini), and
  one of those 4 is a genuine kernel drift on a DISTRIBUTIVE item.
- **gpt-4.1-mini**: 5 FPs removed → 1 true drift remaining (a word problem it
  restructured into a 2-variable system).
- **gpt-5-mini**: 2 FPs removed → **0 true drift**. Remaining failures: 2 schema
  (returned an MC letter for a numeric item), 1 duplicate, 2 within-worksheet
  similarity.

The **semantic normalizer resolved every LINEAR_EQ word-problem case to PASS** —
0 `SEMANTIC_UNKNOWN` across all 204 items. Real drift is still caught: gpt-4o-mini's
made-up trivial problems hard-fail on `ANSWER_MISMATCH` / `SOLUTION_CONTRADICTS_KERNEL`.

---

## D. ROUTING SIMULATION (`scripts/routing-sim.mjs`)

All 3 models ran the **same 68 ItemGenerationSpecs**, so a fallback chain is
walked with each model's *real* corrected outcome on the same spec+kernel — no
capability guesswork. A bounded 2nd-round recovery (expected-value: retryable
classes recover at SIM/DUP 0.6, SCHEMA 0.8, LEAKAGE 0.5) is modelled on the
terminal model. Group C (reasoning structures, ~9% of items) resolves via the
future `AI_CROSSCHECK_REQUIRED` state.

| policy | valid-item completion | det.-only | full-worksheet (6) | calls/item | cost/item | 4o / 4.1 / 5 call share | fallback rate | p50 worksheet latency @conc.4 |
|---|---|---|---|---|---|---|---|---|
| **A** — 4.1-mini → 5-mini, + recovery | **99.4%** | 90.6% | 5/6 (83%) | 1.31 | **~37 VND** | 0 / 90 / 10 | 8.8% | ~11.4 s |
| **B** — structure route (4o→4.1→5 simple; 4.1→5 complex), + recovery | **99.4%** | 90.6% | 5/6 (83%) | 1.44 | ~35 VND | 23 / 68 / 9 | 14.7% | ~11.8 s |
| **C** — 5-mini everywhere, + recovery | 98.2% | 87.9% | 4/6 (67%) | 1.19 | ~50 VND | 0 / 0 / 100 | 0% | ~21.0 s |

Without the 2nd-round recovery: A/B = 98.5% valid-item, 89.7% det., 1 unresolved;
C = 95.6% / 85.3% / 3 unresolved.

Observations:
- **C loses** despite using only the strongest model — with no cross-model
  fallback, gpt-5-mini's own schema/dup/similarity failures go unresolved, and it
  costs 35 % more per item and 2× the latency.
- **B barely beats A on cost** (~2 VND/item) while adding a third model, ~1.7×
  the fallback rate, and more moving parts. The gpt-4o-mini tier's simple-item
  share is small and ~25 % of its output escalates anyway.
- **A is the sweet spot**: gpt-4.1-mini carries 90 % of calls, gpt-5-mini mops up
  the hard 10 %, gpt-4o-mini is not used.

---

## E. RECOMMENDED PRODUCTION ROUTING

**Policy A′** — `gpt-4.1-mini` default, `gpt-5-mini` fallback + first-choice for the top complexity slice. **Not tier-bound.**

```
per item slot:
  route:
    K ≥ 4  OR  targetRole ∈ {FRONTIER}  OR  thinkingLevel = T5   → gpt-5-mini
    else                                                          → gpt-4.1-mini
  generate → validate (kernel v3 reconciliation) → keep if PASS
  on FAIL / SEMANTIC_UNKNOWN:
    retry same model once (diversity-forcing instruction for similarity/dup;
      format-forcing for schema; structure-forcing for SEMANTIC_UNKNOWN)
    still failing → escalate to gpt-5-mini (once, + one retry)
    still failing → deterministic last resort:
      Reference-Library item for the skill, OR a MathKernel-templated item with
      minimal AI verbalization  → human-review queue if even that is unavailable
  Group C (reasoning, no kernel) → content gates only → AI_CROSSCHECK_REQUIRED
assemble worksheet from accepted slots; never regenerate an already-accepted slot
```

- **gpt-4o-mini: rejected for production.** It drifts even on simple structured
  arithmetic (~6 %), duplicates heavily on small worksheets, and its cost saving
  in Policy B is ~2 VND/item — not worth the drift risk or the routing branch.
- **gpt-4.1-mini: default production generator — CONFIRMED.**
- **gpt-5-mini: high-complexity generator + strong fallback — CONFIRMED.**

---

## F. ESTIMATED COST / WORKSHEET

Policy A′, ~11 items/worksheet, 1.31 calls/item, verification per-call costs
(4.1-mini $0.00104, 5-mini $0.00160):

| | value |
|---|---|
| cost / item | ~$0.0014 (~**37 VND**) |
| cost / 11-item worksheet | ~$0.016 (~**410 VND**) |
| cost / *completed* worksheet (incl. recovery + fallback) | ~$0.019 (~**500 VND**) |
| vs plan budget envelopes (v1.1 target FREE 2K / BASIC 8K / … VND per *user*) | a worksheet is a small fraction of any tier's monthly envelope |

Latency: p50 ~2.7 s/call → ~11 s wall per worksheet at concurrency 4 (the ~10 %
of slots on gpt-5-mini at ~6 s dominate the tail).

---

## G. ESTIMATED COMPLETION RATE

| metric | Policy A′ |
|---|---|
| **valid-item completion** (deterministic + Group-C-crosscheck) | **~99.4%** |
| deterministic-only item completion | ~90.6% |
| kernel-supported deterministic correctness | **100%** (0 wrong answers accepted, all runs) |
| **full-worksheet completion (11 items, first assembly)** | ~0.994¹¹ ≈ **93–94%** |
| full-worksheet completion after a 2nd recovery pass on the stuck slot | ~**97–98%** |
| to reach ≥ 99% worksheet | needs the deterministic last-resort (Reference-Library / kernel-template slot) for the final ~1–2% of slots — a **pipeline** feature, not a model capability |

---

## H. REMAINING TECHNICAL BLOCKERS

1. **Full-worksheet ≥ 99% is a pipeline gap, not a model gap.** Item completion
   ~99.4% compounds to ~93–94% for an 11-item worksheet. Closing it needs:
   (a) the bounded 2nd-round recovery (modelled, not yet built into
   `orchestrateItemGeneration` — currently `maxRetriesPerItem: 1`);
   (b) a **deterministic last-resort slot** (Reference-Library item or
   MathKernel-templated item) for the rare item no model can generate cleanly;
   (c) a human-review queue for anything still stuck.
2. **Group C (~9% of items) depends on `AI_CROSSCHECK_REQUIRED`** — currently a
   stub that always returns UNCERTAIN. Those items are deliverable as
   content-accepted / PENDING_CROSSCHECK, but not deterministically verified.
   Building the paid crosscheck is a separate, approval-gated step.
3. **Within-worksheet similarity on ≥ 12-item worksheets** is the dominant
   *retryable* failure for every model (trigram 0.6–0.9 on formulaic types like
   ANGLE_SUM / bare LINEAR_EQ). Needs a diversity-forcing retry instruction
   (deterministic, cheap) and possibly a review of the similarity thresholds for
   formulaic problem types — a distinct piece of work.
4. **`orchestrateItemGeneration` does not yet implement**: model routing
   (currently a single injected generator), the escalation chain, the 2nd-round
   recovery, or the deterministic last resort. The simulation shows the target;
   the orchestrator needs the multi-model + multi-round wiring.
5. **Sample size**: the routing simulation is 6 worksheets / 68 items / 1 run per
   model. The direction is robust (gpt-4o-mini out, gpt-4.1-mini default,
   gpt-5-mini fallback) but the exact completion % on a chosen policy should be
   confirmed with one more small paid pass **after** the orchestrator implements
   the recovery pipeline.

---

## STOP (§12)

Not run: paid generation · gpt-4o · MODE B · LIVE · production feature-flag
changes · paid crosscheck. Returned A–H above. Awaiting approval.
