# 58 — Answer Verification Architecture (deterministic MathKernel)

> **CHECKPOINT (doc 58 §12). Architecture built + validated locally with the
> mock and fake adapters. NO paid model call made. Awaiting anh's approval for
> Round 2.**

Round 1 established: the generation architecture is viable, but PRODUCTION-ready
acceptance was ≈ 0–3% because deterministic answer-verification coverage was
0–5% — no model reliably writes bare closed computations, and the narrow
verifier can't check word problems. This phase fixes that with a deterministic
**MathKernel / ProblemInstance** layer.

Full suite **688 pass / 43 skip / 0 fail**; web + mobile typecheck clean.
Commit `10bd005`.

---

## A. MathKernel architecture

```
ItemGenerationSpec            (unchanged — the educational contract)
      │  deterministic  (generateMathKernel)
      ▼
MathKernel  ← THE mathematically authoritative facts:
      │       operands · operationGraph · intermediateValues ·
      │       expectedAnswer · answerKind · units ·
      │       canonicalVerificationExpression · requiredNumbersInPrompt ·
      │       constraints (integer-result / simplified / range) · solutionOutline
      │  (embedded in ProblemDNA — the AI SEES the kernel)
      ▼
AI verbalization             prompt · distractors · hints · workedSolution · rubric
      │       — may NOT change operands / operation graph / expectedAnswer /
      │         answerKind / units / skill / K / T / curriculum / prereq
      ▼
composeExercise(itemSpec, content, kernel)   — kernel.answerKind is authoritative
      ▼
acceptItem(…, { mathKernel })
      ▼
validateAgainstKernel(exercise, kernel)   — HARD gate (doc 58 §6):
      answer == expectedAnswer · every given number survives in the prompt ·
      units consistent · solution doesn't contradict · distractor sanity ·
      solvable.  Any contradiction → DETERMINISTIC_WRONG → regenerate that item.
```

New files (`@copilot/exercise-gen` unless noted):

| file | role |
|---|---|
| `@copilot/domain/exercise-gen.ts` (added) | `MathKernel`, `KernelAnswer`, `MathKernelFamily` (14) + `MATH_KERNEL_GROUP`, `KernelConsistencyResult`/codes, `CrosscheckVerdict`, `ItemAnswerStatus`, `ItemAcceptanceResult.productionReady` |
| `math-kernel.ts` | `resolveMathFamily` (spec → family, reasoning → `null`) + 14 deterministic generators + `generateMathKernel` (seeded RNG, dodges forbidden/recent number tuples) |
| `kernel-validator.ts` | `validateAgainstKernel` — the deterministic consistency gate |
| `answer-crosscheck.ts` | `AnswerCrosscheckAdapter` port + `PASS`/`FAIL`/`UNCERTAIN` + `createStubAnswerCrosscheck` (always `UNCERTAIN`, never silently accepts) — FALLBACK only, no paid call |
| `problem-type-matrix.ts` | `classifyProblemTypes` (§9 matrix) + `coverageOverSpecs` |
| `item-validator.ts` (changed) | kernel becomes the verification authority when present |
| `compose.ts` / `problem-dna.ts` / `item-orchestrator.ts` / `mock-item-generator.ts` / `luna-item-generator.ts` (changed) | thread the kernel through |
| `@copilot/testing/benchmark/kernel-coverage.test.ts` (new) | §9/§11 local benchmark — no paid call |

## B. Supported problem types (Group A — deterministic kernel)

14 families: `INT_ARITH` · `DISTRIBUTIVE` · `SUM_DIFF` · `UNIT_RATE` ·
`FRACTION_ARITH` (with simplification) · `RATIO_SHARE` · `LINEAR_EQ` ·
`ANGLE_SUM` · `ANGLE_TYPE` (choice) · `PERCENT` · `UNIT_CONVERSION` ·
`RECT_GEOMETRY` · `WORD_1STEP` (op-aware) · `WORD_2STEP` (2 chained ops).

Of the **73 KB problem types**: **64 → Group A** (a kernel family would cover a
generated item), **0 → Group B**, **9 → Group C**.

## C. Unsupported types (Group C — no kernel, `AI_CROSSCHECK_REQUIRED`)

All 9 are open reasoning / proof / HSG:
`M4.PT.DIST.CREATE` · `M7.PT.RATIO.TRANSFORMED_DENOMINATORS` ·
`M7.PT.RATIO.MULTIVARIABLE_NONLINEAR_REASONING` ·
`M7.PT.MULTIVAR.RATIONAL_DENOMINATOR_SYSTEMS` ·
`M7.PT.ALG_IDENTITY.CONDITIONAL_SIMPLIFICATION` · `M7.PT.ALG_IDENTITY.PROOF` ·
`M7.PT.ALG_IDENTITY.NONLINEAR_SYSTEM_HSG` · `M7.PT.PROOF.IDENTITY_PROOF` ·
`M7.PT.PROOF.HSG_TRANSFORMATION`.

Plus, at generation time, the `explain_or_justify` / `find_the_error` /
`construct_an_example` / `compare_and_decide` problem structures never resolve to
a kernel.

## D. Coverage across the 26 benchmark specs (260 items)

| | value |
|---|---|
| **kernel-covered** | **229 / 260 = 88.1%** |
| reasoning items (never kernel) | 26 (10.0%) |
| other uncovered (compare_and_decide ×3, 2 unrouted) | 5 (1.9%) |
| covered by family | INT_ARITH 41 · DISTRIBUTIVE 52 · RATIO_SHARE 42 · WORD_1STEP 28 · UNIT_RATE 22 · FRACTION_ARITH 17 · LINEAR_EQ 14 · WORD_2STEP 9 · ANGLE_TYPE 2 · ANGLE_SUM 1 · SUM_DIFF 1 |

**88.1% ≥ the §10 target of 70%.**

## E. Deterministic verification coverage

With a kernel present, verification is **not** parsing the AI's prose — it is
"does the AI's answer equal `kernel.expectedAnswer` and did every given number
survive". So verification coverage == kernel coverage == **88.1%** of items, and
**100%** of non-reasoning items in most specs. (Round 1: 0–5%.)

## F. Production-ready acceptance on kernel-supported types

Local mock benchmark (deterministic mock generator that uses the kernel's exact
numbers + answer, 26 specs × 2 modes, 1 retry):

| metric | value |
|---|---|
| kernel coverage | 88.1% |
| **kernel-supported production rate** (of kernel items content-accepted) | **100.0%** |
| **kernel-supported WRONG rate** | **0.00%** |
| deterministic-wrong rate (all attempts) | 0.00% |
| content acceptance (overall) | 79.6% |
| production acceptance (overall) | 67.7% |
| crosscheck-required (of content-accepted) | 15.0% |
| schema / skill / curriculum / prereq safety | 100% / 100% / 100% / 100% |

The **§10 target — production-ready ≥ 98% for kernel-supported types after ≤ 1
retry — is met by the mock (100%, 0 wrong)**. The real question Round 2 answers
is whether a live model *preserves* the kernel's numbers and answer; the kernel
validator enforces that as a hard gate, so a model that drifts simply gets
regenerated (and shows up as a MODEL failure, not a false accept).

The overall 79.6% content / 67.7% production for the *mock* is a mock ceiling —
its ~28-template pool collides on 16-item single-skill worksheets (the real
similarity gate correctly rejects those). A real model varies phrasing freely.

## G. Remaining crosscheck-required %

15.0% of content-accepted items (the reasoning / open items). These stay
`PENDING_CROSSCHECK` — honestly not production-ready. `AnswerCrosscheckAdapter`
is a stub; no paid cross-check is wired. Per §8 this is deliberate: the fallback
path exists as an interface, and the honest state is preserved.

## H. Regression test status

`688 pass / 43 skip / 0 fail`. New: `kernel-coverage.test.ts` (matrix into
A/B/C, coverage ≥ 70% across the 26 specs, mock kernel-supported production
≥ 95% / 0 wrong). `item-pipeline.test.ts` + `item-generation-benchmark.test.ts`
updated for the two-tier + kernel metrics.

## I. Educational invariants

**None changed.** The kernel is a NEW deterministic layer; `ItemGenerationSpec`,
`selectLearningTargets`, the gap engine, readiness, curriculum safety,
K/T-independence and the 8-gap discrimination are untouched. `answerKindFor` was
*corrected* (geometry naming → choice) — a bug fix, not an invariant change.

## J. Proposed Round 2 benchmark plan

Unchanged from the doc 56 §4 spec, now with the kernel active:

- **26 benchmark specs × MODE A (1 item/call) × 1 retry × no fallback.**
- Models: **gpt-4o-mini, gpt-4.1-mini, gpt-5-mini** (no gpt-4o — §7).
- Estimate: **780 first-pass calls, ≤ 1560 with retries** (780 requested items ×
  3 models). Per-call ≈ 1.1–1.5k in / 0.3–0.7k out.
- Cost: with the smoke/Round-1 unit costs — gpt-4o-mini ≈ $0.05, gpt-4.1-mini
  ≈ $0.18, gpt-5-mini ≈ $0.30 (slow + verbose) → **≈ $0.55 total**. **Propose
  hard cap `maxCostUsd: 1.0`**, per-call guardrail, incremental per-spec flush.
- Report per model: kernel coverage, kernel-supported production-ready
  (first-pass + after 1 retry), kernel-supported WRONG rate, CONTENT vs
  PRODUCTION acceptance, crosscheck-required %, schema / skill / K/T /
  curriculum / prereq safety, leakage, uniqueness, latency, tokens, cost per
  PRODUCTION item, and every CONTENT failure by category
  (MODEL / VALIDATOR / KERNEL_DRIFT / INFRA / LEAKAGE / OTHER).

## STOP — approval needed

No Round 2 call until anh approves this checkpoint. On approval: run Round 2 as
above under `maxCostUsd: 1.0`, STOP, report.
