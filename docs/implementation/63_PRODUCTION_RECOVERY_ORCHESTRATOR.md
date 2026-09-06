# 63 — PRODUCTION RECOVERY ORCHESTRATOR

> 2026-09-06. FREE phase — **no paid generation, no LIVE, no paid crosscheck, no
> subscription-routing change, gpt-4o-mini NOT reintroduced.** Builds the
> per-slot recovery state machine, multi-model routing, failure-specific retries,
> deterministic last-resort, cost guardrails, per-model concurrency and
> privacy-safe observability. Proven offline with fault injection.

Locked roles (doc 62 §E): **DEFAULT = gpt-4.1-mini**, **HIGH_COMPLEXITY & fallback
= gpt-5-mini**. gpt-4o-mini is not in the production path.

---

## A. ROUTING IMPLEMENTATION — `model-router.ts` (`model-router.v1`)

`routeItemModel(itemSpec) → { role: 'DEFAULT' | 'HIGH_COMPLEXITY', reason, routerVersion }`.
Deterministic, versioned, **never a function of subscription tier**.

**HIGH_COMPLEXITY when ANY of:**
- `knowledgeLevel ≥ K4`
- `thinkingLevel === T5`
- `targetRole === 'FRONTIER'`
- `problemStructure ∈ HIGH_COMPLEXITY_STRUCTURES` — an **explicitly maintained set**
  (`multi_step_word_problem`, `compare_and_decide`, `explain_or_justify`,
  `find_the_error`, `construct_an_example`), not inferred.

Otherwise **DEFAULT**. The orchestrator also accepts a caller override
`config.highComplexityStructures`.

---

## B. RECOVERY STATE MACHINE — `worksheet-orchestrator.ts` (`worksheet-orchestrator.v1`)

`orchestrateWorksheet(input) → WorksheetResult`.

**Slot states (§6):** `PENDING → GENERATING → VALIDATING → {RETRYING | ESCALATING
| LAST_RESORT} → {READY | PENDING_CROSSCHECK | FAILED}`.

**Worksheet states:** `READY` · `READY_WITH_PENDING_CROSSCHECK` · `FAILED`.

**Per round** (bounded to `2 + 2·(maxRetriesPerModel+1)` = 6 with defaults):
1. **generation phase** — every non-terminal slot gets one attempt, grouped by
   model role, each role pool run at its own bounded concurrency.
2. **acceptance phase** — SEQUENTIAL in worksheet order so accepted siblings grow
   deterministically for the uniqueness / similarity gate. `composeExercise` →
   `acceptItem` (kernel v3 reconciliation).
3. **transition** per slot:
   - accepted + productionReady → `READY`
   - accepted + `CROSSCHECK_REQUIRED` (Group C) → `PENDING_CROSSCHECK`
   - FAIL / `SEMANTIC_UNKNOWN`:
     - `perModelAttempts ≤ maxRetriesPerModel` → `RETRYING` (same model, failure-
       specific instruction)
     - else if role was DEFAULT → `ESCALATING` (switch to HIGH_COMPLEXITY, reset
       per-model counter)
     - else if last-resort eligible (kernel present, Group A) → `LAST_RESORT`
     - else → `FAILED`
4. **cost guard** — before any model call, if `actualCost + estNextCall >
   ceiling`, that call is skipped; the slot then falls to `LAST_RESORT` (Group A)
   or `FAILED`.

Accepted slots are **never** re-generated. A `FAILED` slot never discards the
others — `WorksheetResult.items` always carries every accepted slot in order.

---

## C. RETRY POLICIES — `retry-context.ts` (`retry-context.v1`)

`buildRetryContext(acceptResult, answerStatus, kernel) → { reason, instruction }`
— **exactly one** Vietnamese imperative instruction, derived from the failure
category. Never a dump of validator messages.

| reason | instruction (gist) |
|---|---|
| `SIMILARITY_OR_DUPLICATE` | đổi HẲN bối cảnh + cách diễn đạt + số cụ thể, giữ dạng toán |
| `KERNEL_DRIFT` | GIỮ NGUYÊN phép tính `<canonicalVerificationExpression>`, các số `<required>`, đáp số `<expected>`; chỉ viết lại lời văn |
| `SCHEMA` | sửa đúng định dạng (số/phân số/6 bậc gợi ý/rubric), không đổi nội dung toán |
| `LEAKAGE` | sinh câu MỚI HOÀN TOÀN về bối cảnh + số liệu |
| `SEMANTIC_UNKNOWN` | dùng cách diễn đạt ĐƠN GIẢN, TRỰC TIẾP hơn (ưu tiên nêu thẳng phương trình `<expr>`), giữ đúng số + đáp số |
| `CURRICULUM_OR_LEVEL` | chỉ dùng kiến thức và mức K/T đã ghi |

---

## D. LAST-RESORT — `last-resort.ts` (`last-resort.v1`) + `kernel-templater.ts` (`kernel-templater.v1`)

`deterministicLastResort({ itemSpec, kernel, dna, siblingPrompts, referencePrompts })`.

- **Group A only** (`MATH_KERNEL_GROUP[family] === 'A'`) — refuses Group B / no
  kernel with a structured `reason`.
- `buildContentFromKernel(dna, variant)` — a family-specific scenario template
  that uses the kernel's **exact** `requiredNumbersInPrompt`, `operationGraph`,
  `expectedAnswer`, `units`. NO reference wording (its own noun/thing pools).
- Rotates `variant` (up to 24) until `checkItemSimilarity` returns `PASS` against
  the accepted siblings + the skill's reference examples.
- The produced item still goes through the **full** `composeExercise` +
  `acceptItem` gate — 100% answer correctness, kernel consistency, curriculum
  safety, K/T bounds, no leakage, within-worksheet uniqueness are all enforced,
  not assumed.
- `kernel-templater.ts` is the shared source for both the mock item generator
  (`variant = 0`) and the last resort — one templater, one set of tests.

It is a **reliability fallback**, not a generation source.

---

## E. GROUP C

No-kernel reasoning / open items: `composeExercise` + content gates run; the
answer status is `CROSSCHECK_REQUIRED`. The slot ends `PENDING_CROSSCHECK`,
`productionReady = false`. It is **never** marked production-verified. A worksheet
with any such slot is `READY_WITH_PENDING_CROSSCHECK`. No paid crosscheck is
called in this phase — the stub `AnswerCrosscheckAdapter` (always UNCERTAIN)
remains the only implementation.

---

## F. COST GUARDRAILS (§7)

- `config.costCeilingUsd` — a **hard per-worksheet** USD ceiling. It composes
  with (does not replace) the plan-level `@copilot/ai` `AIBudgetGuardrail`, which
  is unchanged and still plan-independent.
- Pre-call check `actualCost + EST_CALL_USD (0.003) > ceiling` → the call is
  skipped, `totals.costCeilingHit = true`, and the slot falls to the
  deterministic last-resort (Group A) — **no silent overspend**.
- `WorksheetTotals`: `modelCalls`, `retries`, `fallbackCalls`, `lastResortCalls`,
  `inputTokens`, `outputTokens`, `estimatedCostUsd`, `actualCostUsd`
  (`computeActualCost` via the effective-dated `PricingRegistry` for non-mock
  providers), `costCeilingHit`.

Fault-injection test `doc 63 §7`: ceiling `$0.004`, real `gpt-4.1-mini` pricing →
`costCeilingHit = true`, `actualCostUsd ≤ ceiling + one call`, Group A slots still
completed via last-resort.

---

## G. CONCURRENCY POLICY (§8)

`config.concurrency = { default: 4, highComplexity: 2 }` — **configured
separately per model**. The generation phase runs each role's slots through its
own bounded pool; gpt-5-mini can never fan out beyond its (smaller) limit. The
acceptance phase is intentionally sequential (sibling-uniqueness determinism).

---

## H. OBSERVABILITY (§9) — privacy-safe by construction

`WorksheetTrace` records **only**: builder/validator/router/retry/last-resort
**versions**; per-slot `{ itemId, index, kernelFamily, initialRole, routeReason,
finalState, attempts:[{ attempt, model, role, step, accepted, failureCategory,
retryReason, latencyMs }], lastResortUsed, crosscheckRequired, answerStatus,
productionReady, slotLatencyMs }`; `totals`; `worksheetLatencyMs`.

**Never** in the trace: prompt, answer, worked solution, hints, rubric, child
name, evidence, gap content, school data. Test `doc 63 §9` asserts the serialized
trace matches none of `/Tính:|Đáp số|Lời giải|workedSolution|prompt/`.

---

## I. MOCK / FAULT-INJECTION RESULTS (§10) — `fault-injecting-generator.ts`

`createFaultInjectingGenerator({ scripts: { itemId → { failAttempts, mode, role? } } })`
— deterministic, no network. Modes: `SIMILARITY`, `DUPLICATE`, `KERNEL_DRIFT`,
`SCHEMA`, `LEAKAGE`, `SEMANTIC_UNKNOWN`, `INABILITY`. When not failing, returns
kernel-templated content that passes every gate.

`worksheet-orchestrator.test.ts` — **13 tests, all green:**

| scenario | asserted |
|---|---|
| all-success | every slot READY on attempt 1, 1 call each, versioned router |
| routing | FRONTIER / T5 / K4+ / reasoning-structure → HIGH_COMPLEXITY |
| gpt-4.1 retry success | similarity fail → `retry_same` with `SIMILARITY_OR_DUPLICATE` reason → READY |
| gpt-4.1 → gpt-5 fallback | persistent DEFAULT failure → `escalate` to gpt-5-mini → READY, `fallbackCalls ≥ 1` |
| failure-specific retry | KERNEL_DRIFT fail → `retryReason === 'KERNEL_DRIFT'` |
| both models fail → last-resort | Group A → `lastResortUsed`, `finalState READY`, `productionReady` |
| SEMANTIC_UNKNOWN → recovery | never resolves → last-resort, not FAILED |
| Group C | `PENDING_CROSSCHECK`, `productionReady = false`, worksheet `READY_WITH_PENDING_CROSSCHECK` |
| partial worksheet | one doomed slot (last-resort off) → `FAILED` slot, **every other slot still delivered** |
| cost ceiling | real pricing, `$0.004` → `costCeilingHit`, no overspend, last-resort fills Group A |
| observability | serialized trace contains no prompt/answer/solution text |
| §11 aggregate | see J |

Full free regression: **748 tests / 0 fail**; `tsc -b` clean; web + mobile
typecheck clean. New modules lint-clean.

---

## J. ESTIMATED COMPLETION RATE (§11)

`doc 63 §11` aggregate — **40 worksheets**, fault mix calibrated to the paid
verification (~18% of items injected with a failure, spread across all
categories, `KERNEL_DRIFT` deep-fail the minority so escalation + last-resort are
both exercised):

| metric | result | §11 target |
|---|---|---|
| kernel-supported deterministic correctness | **100.0%** | = 100% ✓ |
| valid-item completion | **100.0%** | ≥ 99.5% ✓ |
| full-worksheet completion | **100.0%** (40/40) | ≥ 99% ✓ |
| no silent `SEMANTIC_UNKNOWN` / `DETERMINISTIC_WRONG` acceptance | asserted per slot | ✓ |
| max attempts / slot | **5** | bounded ✓ |
| calls / item | **1.10** | bounded ✓ |

> These numbers come from **fault injection**, where the non-failing path is the
> deterministic templater (always valid). They prove the **recovery machinery**
> closes every gap — the deterministic last-resort is what lifts full-worksheet
> completion to 100% (doc 62 §H flagged this as the missing piece; it now
> exists). The *real* completion rate against live models will be lower on the
> messy-failure tail and MUST be measured with the small paid E2E in §K.

Combined with the doc 62 routing simulation (real model outcomes, ~99.4%
valid-item / ~90.6% deterministic before last-resort), the expectation for the
production pipeline is: **deterministic ~91–93%, last-resort lifts full-worksheet
to ≥99%, ~9% of items land PENDING_CROSSCHECK (Group C).**

---

## K. PROPOSED PAID E2E VERIFICATION (§12) — NOT RUN

| parameter | value |
|---|---|
| worksheets | **5–6** representative `ExerciseGenerationSpec`s (G4 + G7, mixed structure/K/T, ≥1 with a FRONTIER target, ≥1 reasoning-heavy) |
| orchestrator | `orchestrateWorksheet` — real routing, real retry, real escalation, real last-resort |
| models | `gpt-4.1-mini` (default) + `gpt-5-mini` (high-complexity & fallback). **No gpt-4o / gpt-4o-mini.** |
| retries | `maxRetriesPerModel: 1` |
| **hard spend cap** | **≤ USD 0.50** (per-worksheet `costCeilingUsd` set so the sum cannot exceed it; plus a run-level guard) |
| raw outputs | full prompt + worked solution per slot → immutable sidecar, no child PII |
| report | per-slot state trace, per-model calls/cost/latency, full-worksheet completion, deterministic vs PENDING_CROSSCHECK split, last-resort invocation count, comparison to the §J fault-injection estimate |

Runner would be `RUN_WORKSHEET_E2E=1 WS_E2E_CAP_USD=0.5 OPENAI_API_KEY=… npx vitest run …` — **awaiting approval before any paid call.**

---

## L. REMAINING BLOCKERS

1. **Live-model completion is still an estimate.** §J is fault-injection; §K is
   the paid confirmation. Until §K runs, treat "≥99% full-worksheet" as *designed
   for and demonstrated in simulation*, not *measured in production*.
2. **`orchestrateWorksheet` is not yet wired to a running service.** It is a pure
   library function; `services/api` still calls the C5 shadow path
   (`orchestrateItemGeneration`, single generator). Wiring it — behind an OFF
   feature flag — is a separate step.
3. **Group C crosscheck is a stub.** ~9% of items depend on it for deterministic
   verification. Building the paid `AnswerCrosscheckAdapter` is approval-gated and
   out of scope here.
4. **The last-resort covers Group A only.** A Group B kernel (semi-deterministic)
   or a no-kernel item that no model can generate cleanly still ends `FAILED` →
   the worksheet is `FAILED` and needs a human-review queue (not built).
5. **Similarity-gate strictness on formulaic types** (ANGLE_SUM "third angle",
   bare LINEAR_EQ) on ≥12-item worksheets — a distinct tuning task; here it just
   drives more retries / last-resort invocations.
6. **`PricingRegistry` has `gpt-4.1-mini` / `gpt-5-mini` list prices dated
   2026-01-15** (doc 59). If OpenAI changes pricing, the cost guard's accuracy
   drifts until the registry is updated — the guard fails safe (over-estimates)
   only if `EST_CALL_USD` stays conservative.

---

## STOP (§12)

Not done: paid generation · LIVE · paid crosscheck · subscription-routing change
· gpt-4o-mini. Returned A–L. Awaiting approval for the §K paid E2E.
