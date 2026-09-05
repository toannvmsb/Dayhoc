# 61 — SMALL PAID VERIFICATION RESULTS (doc 60 §8 follow-up)

> 2026-09-06. 6 specs · MODE A · ≤1 retry · no fallback · models gpt-5-mini /
> gpt-4.1-mini / gpt-4o-mini (NO gpt-4o). **TOTAL SPEND $0.2473** (budget $0.30,
> hard cap $0.35). 6/6 specs for all 3 models. FULL raw outputs (prompt + worked
> solution, no child PII) → `ROUND2_VERIFY_raw.jsonl` (204 rows = 68 items × 3).
> `ROUND2_VERIFY.txt` = harness report. `scripts/verify-verdicts.mjs` =
> per-item adjudication from the raw text.

Specs: `BENCH-LT-G4-02` (UNIT_RATE), `BENCH-LT-G4-07` (DISTRIBUTIVE),
`BENCH-LT-G7-03` (RATIO_SHARE), `BENCH-LT-G7-04` (LINEAR_EQ), `HC06`
(INT_ARITH + LINEAR_EQ), `HC03` (RATIO_SHARE control). 68 items/model.

---

## 0. TL;DR

1. **P0 fix HELD** — the SOLUTION_CONTRADICTS_KERNEL operand-grab false positive
   ("concludes X where X is a factor of Y") **did not reappear** in any item.
2. **P1 signed-constant HELD** — `12x + (−10) = 38` (U+2212 minus) validated
   correctly and was accepted.
3. **⚠ TWO KNOWN VALIDATOR-FP CLASSES REAPPEARED IN A NEW FORM** (doc 60 §2 →
   STOP + classify as VALIDATOR):
   - **semantic-structure FP**: the P1 `SEMANTIC_STRUCTURE_MISMATCH: "SOLVE_EQUATION
     but the prompt shows no equation to solve"` check **rejects valid word-problem
     realizations** of a LINEAR_EQ kernel (the worked solution correctly sets up
     `ax ± b = c`, the answer is correct, but the *prompt* is prose). **6 items**
     (gpt-4.1-mini ×4–5, gpt-5-mini ×2).
   - **number-preservation FP**: `KERNEL_NUMBER_DROPPED` fires when the coefficient
     is written as a Vietnamese number word ("Hai hộp" = `2x`, "gấp đôi" = `2·`).
     **3 items**.
   - plus **1 new `OPERAND_MUTATION` FP**: answer `3` coincided with "chia thành
     **3** phần" (part count), flagged as leaked data.
4. Per §2 → **STOP. These are VALIDATOR, not MODEL. `FULL_ROUND2_RERUN_REQUIRED`
   is deferred until the validator FP is fixed** (a full rerun now would still be
   contaminated).
5. **Substantive signal is still decisive and it SHARPENS the ranking:**
   - **gpt-5-mini: 0 true kernel drift. gpt-4.1-mini: 0 true kernel drift.**
   - **gpt-4o-mini: ~8 true kernel drift / 68 (~12%)** — it abandons the kernel
     equation and writes trivial 1-step problems with wrong answers, independently
     confirmed by `ANSWER_MISMATCH`.
   - → **gpt-4.1-mini is NOT dominated** (the clean re-score said it was, off
     contaminated data): zero true drift, same as gpt-5-mini, at ⅓ the cost and
     2× the speed.
6. **Comparison to clean re-score**: gpt-5-mini +0.4 pp (near-exact),
   gpt-4.1-mini +4.9 pp, **gpt-4o-mini −5.4 pp** (clean re-score under-counted its
   real drift because truncated logs hid the trivial-problem substitutions).

---

## 1. §2 — DID THE VALIDATOR FIXES HOLD?

| known FP class | reappeared? | evidence |
|---|---|---|
| `SOLUTION_CONTRADICTS_KERNEL` operand-grab (P0) | **NO ✓** | no "concludes X, kernel Y" with X a factor of Y in any of 34 failures |
| `LINEAR_EQ` signed-constant (P1) | **NO ✓** | gpt-5-mini `item-09` "Tìm x biết 12x + (−10) = 38." accepted; `−10` (U+2212) matched by abs |
| **semantic-structure FP** | **YES ✗** | 6 items — see §1a |
| **number-preservation FP** | **YES ✗** | 3 items — coefficient as number word — see §1b |
| `OPERAND_MUTATION` (new) | **YES ✗** | 1 item — coincidental value collision — see §1c |

### 1a. Semantic-structure FP (introduced by the P1 fix, over-corrected)

The P1 change made `SEMANTIC_STRUCTURE_MISMATCH` for SOLVE_EQUATION fire whenever
the **prompt** lacks a literal `[var] … = number`. But a LINEAR_EQ kernel is
legitimately realized as a **word problem**:

> **gpt-4.1-mini `BENCH-LT-G7-04::item-11`** (rejected)
> Prompt: *"Một cửa hàng bán 7 hộp bánh mỗi ngày. Nếu số bánh bán ra … giảm 19 …
> tổng số bánh … là 16 …, hỏi số hộp bánh bán được …?"*
> Solution: *"Gọi x … ta có phương trình: 7x − 19 = 16. Chuyển vế: 7x = 35.
> x = 5."* — **correct**. Kernel `7x + (−19) = 16` → x = 5. ✅ answer matches.
> Rejected only because the *prompt* has no `=`.

> **gpt-5-mini `BENCH-LT-G7-04::item-16`** (rejected)
> Prompt: *"Một xưởng … làm 2 hộp đèn mỗi giờ; sau khi loại bỏ 1 hộp lỗi, tổng
> số hộp tốt … là 75. … (Gọi x là số giờ.)"*
> Solution sets up `2x + (−1) = 75` → x = 38. ✅ correct. Rejected for "no
> equation in prompt".

Per doc 58 §5 the kernel owns the **answer**; the AI owns the **scenario**. A
word problem is valid scenario wording. The hard gate must be *answer correctness*
(independent oracle + `ANSWER_MISMATCH` + conservative `SOLUTION_CONTRADICTS_KERNEL`),
not *prompt contains "x = "*.

### 1b. Number-preservation FP — coefficient as a number word

> **gpt-5-mini `BENCH-LT-G7-04::item-13`** (rejected)
> Prompt: *"**Hai hộp** chứa cùng số que diêm; thêm 22 que rời thì tổng số là 30
> que. Gọi x là số que trong mỗi hộp, tìm x."*
> Solution: `2x + 22 = 30` → x = 4. ✅ correct.
> `KERNEL_NUMBER_DROPPED: missing given number(s): 2` — the coefficient `2` is
> "**Hai**", not a digit. The mathematical role (`2x` = two equal boxes) **is**
> preserved.

### 1c. New `OPERAND_MUTATION` FP — value collision

> **gpt-4.1-mini `BENCH-LT-G7-03::item-07`** (rejected)
> Prompt: *"18 chiếc bánh … **chia thành 3 phần** theo tỉ lệ 1 : 1 : 4. Phần đầu
> tiên …?"*  Answer = 18/6 × 1 = **3**. The value `3` also appears as the *number
> of parts*. `OPERAND_MUTATION: the answer 3 appears in the prompt as if it were
> given data` — a coincidental collision, not leaked data.

---

## 2. §3 — PER-MODEL METRICS (as-run, then corrected for the §1 FP)

| | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| items | 68 | 68 | 68 |
| model calls | 95 | 84 | 80 |
| schema pass (calls) | 100% | 100% | 98.8% |
| skill / curriculum / prereq / K / T | 100% | 100% | 100% |
| reference leakage pass | 85.3% | 92.6% | 95.6% |
| sibling uniqueness pass | 98.5% | 100% | 98.5% |
| MathKernel coverage | 92.6% | 92.6% | 92.6% |
| kernel consistency (of accepted) | 100% | 100% | 100% |
| **true kernel drift** | **~8** | **0** | **0** |
| answer mismatch (true) | ~5 | 0 | 0 |
| semantic mismatch (true) | ~1 (mixed) | 0 | 0 |
| worked-solution contradiction (true) | ~3 | 0 | 0 |
| **validator FP (this run)** | **0** | **5 (+1 mixed)** | **2** |
| CONTENT first-pass (as-run) | 60.3% | 76.5% | 82.4% |
| CONTENT after ≤1 retry (as-run) | 75.0% | 85.3% | 89.7% |
| **CONTENT after ≤1 retry (corrected)** | **~75.0%** | **~92.6%** | **~92.6%** |
| PRODUCTION-ready after ≤1 retry (as-run) | 67.6% | 77.9% | 82.4% |
| **PRODUCTION-ready after ≤1 retry (corrected)** | **~67.6%** | **~85%** | **~85%** |
| crosscheck-required (of content-accepted) | 9.8% | 8.6% | 8.2% |
| rejected (as-run) | 25.0% | 14.7% | 10.3% |
| **rejected (corrected, true failures)** | **~25%** | **~6%** | **~7%** |
| avg retries / item | 0.40 | 0.24 | 0.18 |
| latency p50 / p95 (ms) | **2 064 / 2 601** | 2 718 / 4 039 | 6 221 / 12 297 |
| tokens in / out | 128 233 / 21 004 | 112 934 / 26 370 | 106 805 / 50 708 |
| total cost | **$0.0318** | $0.0874 | $0.1281 |
| cost / accepted item | ~16 VND | ~39 VND | ~55 VND |

## 3. §4 — WORKSHEET METRICS

| | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| full worksheet success — first-pass | 0/6 | 1/6 | 2/6 |
| full worksheet success — after ≤1 retry (as-run) | 1/6 | 2/6 | 3/6 |
| **full worksheet success — after ≤1 retry (corrected)** | **~1/6** | **~4–5/6** | **~4/6** |
| **MISSING ITEMS / WORKSHEET after ≤1 retry (as-run)** | **3.67** | **2.50** | **2.00** |
| **MISSING ITEMS / WORKSHEET after ≤1 retry (corrected)** | **~3.67** | **~1.0–1.7** | **~1.67** |

> "Missing items / worksheet" matters because production fills only failed slots.
> A production worksheet-fill loop with a 2nd retry would close most of the
> corrected gap for gpt-5-mini / gpt-4.1-mini; gpt-4o-mini's gap is real drift and
> would need model escalation, not just more retries.

## 4. §5 — VERIFICATION vs CLEAN RE-SCORE

| model | clean re-score (CONTENT after retry) | verification (corrected) | **Δ** |
|---|---|---|---|
| gpt-4o-mini | 80.4% | 75.0% | **−5.4 pp** |
| gpt-4.1-mini | 87.7% | 92.6% | **+4.9 pp** |
| gpt-5-mini | 92.2% | 92.6% | **+0.4 pp** |

- **gpt-5-mini: aligns almost exactly.** The clean re-score was reliable for it.
- **gpt-4.1-mini: better than estimated** — its "kernel drift" in Round 2 was
  almost entirely the P0 operand-grab FP + P1 semantic FP; it has **zero** true
  drift.
- **gpt-4o-mini: worse than estimated** — the clean re-score worked from truncated
  `failureDetail` lines and could not see that gpt-4o-mini's rejected LINEAR_EQ
  word-problem items were *trivial substituted problems with wrong answers*, not
  the operand-grab FP. Real drift was under-counted.

### `FULL_ROUND2_RERUN_REQUIRED`

**Conditional:**
- For **model ranking** → **false.** The verification confirms and sharpens it;
  another 26-spec run would not change the order.
- For a **locked production-acceptance % on the chosen model** → **true, but
  ONLY AFTER the §1 validator FP is fixed.** A full rerun on today's validator
  would still mis-reject valid word-problem realizations (6+/68 on the equation
  worksheet alone) and understate gpt-4.1-mini / gpt-5-mini.

---

## 5. §6 — MODEL ROUTING ANALYSIS (no routing change made)

Observed drift is **concentrated by problem STRUCTURE, not K/T level**:
- bare computation / `direct_computation` (HC06 INT_ARITH, most of G7-03) →
  **all three models fine**;
- **word-problem realizations** of LINEAR_EQ / DISTRIBUTIVE / RATIO_SHARE
  (G7-04, G4-07, HC03) → **gpt-4o-mini abandons the kernel structure**
  (~8/68 wrong-answer drifts); gpt-4.1-mini and gpt-5-mini hold it.

| strategy | est. quality (corrected) | est. cost / item | est. latency p50 | verdict |
|---|---|---|---|---|
| **A. gpt-5-mini everywhere** | ~92–93% content, ~85% production | ~55 VND (~$0.0019) | ~6.2 s | safest; slowest; most expensive |
| **B. gpt-4o-mini everywhere** | ~75% content, ~68% production, **~12% true drift on word problems** | ~12–16 VND | ~2.1 s | **not acceptable** without heavy human review |
| **C. structure routing** | ~90–92% content | ~30–38 VND | ~4–4.5 s | best balance |

**C in detail (not tier-bound — routes on `problemStructure` + retry state):**
- `problemStructure ∈ {direct_computation, …bare kernel}` **and** K ≤ 2 → gpt-4o-mini;
- `problemStructure ∈ {*_word_problem, multi_step_word_problem}` OR K ≥ 3 OR T ≥ 3
  OR FRONTIER / advanced target → gpt-5-mini (or gpt-4.1-mini — see below);
- **any gpt-4o-mini item that fails acceptance → regenerate on gpt-5-mini** (its
  0-drift record means most 4o-mini drifts recover).
- **gpt-4.1-mini as the mid tier**: zero true drift, p50 2.7 s, ~39 VND/item — a
  viable *default* for word problems when gpt-5-mini latency (6 s) hurts UX;
  reserve gpt-5-mini for K4+/frontier/T5.

Rough blend for C (≈40% bare → 4o-mini, ≈60% word → gpt-4.1-mini, 4o-mini
failures retried on gpt-5-mini): **~33 VND/item, ~90–92% corrected content,
p50 ~3.5 s** — near gpt-5-mini quality at ~60% of its cost and ~half its latency.

**Model choice is NOT bound to subscription tier** in any of these.

---

## 6. FAILURE TAXONOMY (verification, corrected)

| category | gpt-4o-mini | gpt-4.1-mini | gpt-5-mini |
|---|---|---|---|
| TRUE_MODEL_KERNEL_DRIFT (wrong answer / abandoned structure) | ~8 | 0 | 0 |
| TRUE_MODEL_CONTENT (within-worksheet similarity) | ~5 | ~4 | ~2 |
| TRUE_DUPLICATE (near-copy / identical) | 2 | 0 | 1 |
| TRUE_MODEL_SCHEMA (MC letter for numeric) | 0 | 0 | 2 |
| TRUE_LEAKAGE (vs reference) | 1 | 0 | 0 |
| **VALIDATOR_FALSE_POSITIVE** | **0** | **5** | **2** |
| MIXED (model wrong + validator FP co-fired) | 1 | 1 | 0 |
| INFRA | 0 | 0 | 0 |

> Separate observation (not a §1 known-FP class): the **similarity gate** may be
> slightly strict on *formulaic* problem types on 16-item worksheets — trigram
> 0.70 on an ANGLE_SUM "third angle of a triangle", jaccard 0.50 on a bare
> equation. Worth a look, does not change any verdict here.

---

## 7. RECOMMENDATION (awaiting anh — nothing done)

1. **Fix the §1 validator FP (FREE, deterministic):** for a MathKernel-supported
   item, demote `SEMANTIC_STRUCTURE_MISMATCH`, `KERNEL_NUMBER_DROPPED` and
   `OPERAND_MUTATION` from **hard gate** to **advisory signal** when the
   independent oracle + `ANSWER_MISMATCH` + conservative
   `SOLUTION_CONTRADICTS_KERNEL` all pass. Concretely:
   - SOLVE_EQUATION: accept a word-problem prompt when the **worked solution**
     contains an equation consistent with the kernel and the answer matches;
   - number preservation: match a required coefficient/operand against Vietnamese
     number words (`hai`→2, `ba`→3, `gấp đôi`→×2, …) — a tiny bounded lexicon;
   - OPERAND_MUTATION: don't flag when the colliding value is explained by a
     structural quantity already in the prompt (part count, group count).
   - Add the 10 raw items from `ROUND2_VERIFY_raw.jsonl` as regression fixtures.
2. **Then** either: (a) re-score `ROUND2_VERIFY_raw.jsonl` offline through the
   corrected validator (FREE, now possible — full text is saved), or (b) one more
   tiny paid pass on the 2 equation-heavy specs (`BENCH-LT-G7-04`, `HC06`) if
   fresh generations are wanted, hard cap **$0.15**.
3. **Model direction (already supported by this data):** gpt-4o-mini is not
   viable as a sole generator (12% real drift on word problems). Choose between
   **A (gpt-5-mini everywhere)** and **C (structure routing with gpt-4.1-mini
   default + gpt-5-mini for K4+/frontier + gpt-4o-mini only for bare K1–K2
   computation, failures escalate)**. gpt-4.1-mini is the surprise: **zero true
   drift at ⅓ the cost of gpt-5-mini**.

## 8. STOPPED (§7)

Not run: full Round 2 · MODE B · gpt-4o · paid answer crosscheck · LIVE
generation · production routing change. Stopped after the verification report.
Total verification spend this phase: **$0.2473**.
