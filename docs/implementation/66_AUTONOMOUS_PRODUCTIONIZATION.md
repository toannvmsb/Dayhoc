# 66 — AUTONOMOUS PRODUCTIONIZATION (Phases 1–9)

> Running log of the autonomous productionization sequence. Each phase: inspect →
> implement → test → regress → commit → document → continue if the gates pass.
>
> **Locked**: DEFAULT = gpt-4.1-mini · HIGH_COMPLEXITY & fallback = gpt-5-mini ·
> gpt-4o-mini NOT in production · routing never tier-bound · MathKernel +
> validator v3 authoritative · LIVE stays OFF.
>
> **Autonomous paid budget**: generation cumulative ≤ USD 2.00 (per-worksheet ≤
> USD 0.05) · Group-C crosscheck ≤ USD 0.50 total.

---

## PHASE 1 — COMPLETE PRODUCTION WIRING  ✅  (`main` Phase-1 commit)

`services/api/src/production/`:

- **`worksheet-generation.ts`** — `resolveWorksheetGeneration({ pool, planFor,
  usageSink, ... })`:
  - `loadAiGenerationConfig(env)` → `OFF` returns `null`; `SHADOW`/`LIVE` build
    the infra. `validateWorksheetStagingConfig` blocking issue → stays `null`.
  - generators: `createLunaItemContentGenerator` over
    `createOpenAiProviderAdapter` for `gpt-4.1-mini` (default) + `gpt-5-mini`
    (high/fallback). `gpt-4o-mini` is never constructed.
  - `PgWorksheetGenerationStore` + `PgReviewQueueStore` (both new).
  - crosscheck: NO adapter passed unless `AI_CROSSCHECK_MODE=LIVE` (+ key +
    factory) — otherwise Group-C items sit `PENDING_CROSSCHECK`, honest.
  - `pseudonymize(id) = sha256(id).slice(0,16)` → `resolveChildRef` /
    `resolveUsageContext` (never a raw id in generation telemetry).
  - single-instance `InMemoryWorksheetShadowQueue` (a deployment injects a real
    queue behind the same port).
- **`pg-ai-usage.ts`** — `insertAiUsageEvent(pool, event)` → `ai_usage_events`
  (INSERT-only ledger).
- **`production-api.ts`**:
  - builds `worksheetGen` once; passes it into the `learningScene` scoped
    `createApi`, so `getToday` → `maybeRunWorksheetGeneration` fires (SHADOW
    only, off the request path, never served, never throws).
  - admin: `worksheetShadowObservability()` (privacy-safe rollup + failure
    breakdown + review-queue rollup) and `purgeReviewQueueSnapshots(days)`.
  - **deletion workflow**: the confirm-delete purge now removes `review_queue` +
    `worksheet_slot_attempts` + `worksheet_slots` + `worksheet_generation_runs`
    for the child's `generation_spec_id`s, before `generation_specs`, under
    `session_replication_role = replica`.

`@copilot/exercise-gen`:

- **`pg-worksheet-persistence.ts`** — `PgWorksheetGenerationStore`
  (transactional `putRun` = run + slots + attempts; append-only PK).
- **`pg-review-queue.ts`** — `PgReviewQueueStore` (one `PENDING → resolved`
  transition via a guarded UPDATE).
- **`worksheet-read-model.ts`** — `shadowRollup` / `failureBreakdown` /
  `reviewQueueRollup` / `purgeReviewSnapshots` — privacy-safe SQL (the tables
  carry no PII; `review_queue` snapshots are short-retention QA data).

**Migration `1758499200000_worksheet_generation.js`** — `generation_spec_id` is
plain text (no FK): the worksheet orchestrator owns its lifecycle; the C5 path
owns the spec row. `down`/`up` re-verified on pg-portable.

**Gates**: OFF → no run (integration test). SHADOW → run persists + telemetry
recorded + `getToday` byte-identical + zero PII in rows/events (integration
test). LIVE → treated as OFF. Deletion cascades (integration test). 40 DB
integration tests green; 774 unit / 0 fail; tsc + web/mobile clean.

---

## PHASE 2 — STAGING SHADOW READINESS  ✅  (`main` Phase-2 commit)

`@copilot/exercise-gen` **`worksheet-guardrails.ts`**:

- `DailyCostGuard(caps, now)` — cumulative UTC-day spend cap; `canRun(est)` is
  the pre-enqueue gate, `record(actual)` after; resets at the day boundary.
  Wired into `runWorksheetShadow` (skip + record) and `resolveWorksheetGeneration`
  (one shared guard).
- `AlertThresholds` + `checkAlerts(rollup, pendingReviewItems)` — full-worksheet
  completion, deterministic-production rate, avg retries/item,
  cost/completed-worksheet, review backlog, cost-ceiling event rate. Staging
  defaults are looser than the pre-LIVE bar.

`services/api/src/production/` **`worksheet-staging-config.ts`**:

- `validateWorksheetStagingConfig(env)` → `{ mode, willRun, defaultModel,
  highComplexityModel, crosscheckMode, costCaps, blocking, warnings }`.
  **Blocking**: `LIVE`; `SHADOW` without `OPENAI_API_KEY`; a forbidden model
  (`gpt-4o(-mini)`); a non-positive cost cap. **Warnings**: model override,
  `AI_CROSSCHECK_MODE=LIVE`, an unusually high daily cap.
- Env: `WORKSHEET_DEFAULT_MODEL` / `WORKSHEET_HIGH_COMPLEXITY_MODEL` (default to
  the locked pair), `WORKSHEET_PER_WORKSHEET_CAP_USD` (0.05),
  `WORKSHEET_DAILY_CAP_USD` (2.00), `AI_CROSSCHECK_MODE` (OFF).

**Migration validation**: `1758499200000` up/down/up verified.
**Synthetic cohort**: `buildItemBenchmarkSpecs(kb)` — 26 deterministic specs
covering G4 + G7 + basic / application / gap-repair / frontier / reasoning /
high-complexity. No real-user data.

19 new tests. 786 unit / 0 fail; tsc + web/mobile clean; 0 lint errors.

### Deployed-staging gap

There is **no deployed staging host** (no Supabase project, no app hosting) — see
memory `project_parent_copilot`. Phase 3's *internal* smoke does not need one: it
runs the real orchestrator + real OpenAI against synthetic benchmark specs with
local Postgres persistence, within the pre-approved budget. A deployed staging
environment is only required for **Phase L / §7** (pilot-shaped `getToday`
traffic) — flagged in the final report.

---

## PHASE 3 — INTERNAL SHADOW SMOKE  ✅  (`main` Phase-3 commit; report `docs/implementation/data/66_shadow_smoke_report.txt`)

`packages/testing/src/benchmark/worksheet-shadow-smoke.live.test.ts`
(`RUN_WS_SMOKE=1`) — **26 synthetic worksheets / 260 items** · real
`orchestrateWorksheet` · gpt-4.1-mini + gpt-5-mini · last-resort ON · crosscheck
OFF · per-worksheet cap $0.05 · cumulative daily cap $2.00 · raw sidecar
`WS_SMOKE_raw.jsonl` (260 rows, PII-scanned clean). **Test PASSED.**

| metric | result | gate |
|---|---|---|
| **TOTAL SPEND** | **$0.4787** / $2.00 | ✓ |
| **kernel deterministic correctness** | **100.0% (229/229)**, kernel wrong = 0 | **P0 ✓** |
| **silent semantic contradiction** | **NONE** (0 SEMANTIC_UNKNOWN accepted) | **P1 ✓** |
| full worksheet completion | 92.3% (24/26) | — |
| valid-item completion | 99.2% (258/260) | — |
| production-ready deterministic | 88.1% | — |
| PENDING_CROSSCHECK | 11.2% (29/260) | — |
| FAILED slots | 2 (0.8%) | — |
| gpt-4.1-mini / gpt-5-mini call share | 67.3% / 32.7% | — |
| retry rate / max attempts / last-resort / cost-ceiling events | 0.34/item / **5** / 7 / **0** | bounded ✓ |
| cost / item / cost / completed worksheet | ~48 VND / ~$0.02 | ✓ |
| slot p50/p95 · worksheet p50/p95 | 4.2/20.3 s · 44/55 s | — |

**No P0/P1.** Two `FAILED` worksheets, both a single **reasoning / Group-C slot**
the generator couldn't produce acceptably after retries → in production these
raise a `NO_KERNEL_GENERATION_FAILED` review-queue row:

- `HC06::item-05` — a HSG-level polynomial-factorisation `construct_an_example`
  (the model's own reasoning was actually correct; a curriculum/level gate
  rejected the above-grade content on a non-frontier reasoning slot).
- `BENCH-LT-G7-05::item-04` — a parallel-lines `compare_and_decide` on a tiny
  4-item worksheet (2 ready + 1 pending + 1 failed).

**P2 (FREE, Phase 8 candidate)**: `construct_an_example` / `compare_and_decide`
reasoning slots fail ~2 / ~30 (~7%). Candidates: relax the curriculum/level gate
for exploratory reasoning structures; a "reasoning last-resort" (a templated
prompt); and — a **product decision, NOT autonomous** — whether one failed
Group-C slot should mark the whole worksheet `FAILED` vs ship it
`READY_WITH_PENDING_CROSSCHECK` minus that slot.

Realistic-mix note: the `BENCH-LT-G4` basic/application specs completed at ~100%;
the failures are on the deliberately-hard `HC*` / small `G7` specs.

---

## PHASE 4 — EXTENDED SHADOW  ⛔  STOPPED ON A P0 FLAG → root-caused → FREE fix → offline-revalidated

Same harness, `WS_SMOKE_PASSES=3` `WS_SMOKE_TAG=_EXT` `WS_SMOKE_DAILY_USD=1.50`.
**78 worksheets / 780 items, $1.4300** (report
`docs/implementation/data/66_shadow_smoke_report.txt` was Phase 3;
`WS_SMOKE_EXT.txt` + `WS_SMOKE_EXT_raw.jsonl` for Phase 4). The run's own
hard-gate assertion **FAILED**:

```
P0: kernel item accepted with a wrong answer —
BENCH-LT-G4-08::egs_LT-G4-08_0::item-15 kernel DETERMINISTIC_WRONG
```

Per the mandatory STOP boundary, I stopped and root-caused before doing anything
else.

### Root cause — a KERNEL DEFECT, not a model error, not a "wrong answer accepted"

- The flagged slot's final state was **`FAILED`**, not `READY` — the orchestrator
  never *accepted* a wrong answer. `kernelProdReady === kernelReady` (680/680):
  every kernel slot that reached READY was deterministically correct. The
  harness's P0 counter was over-broad (it counted a `DETERMINISTIC_WRONG` status
  on a *failed* slot).
- **Why the slot failed**: kernel `item-15` is `3/9 - 4/5 = -7/15`
  (`canonicalVerificationExpression: "3/9 - 4/5"`, `expectedAnswer -7/15`) — a
  **subtraction**. But `deriveSemantics` set `semantics.operation: 'ADDITION'`.
  `operationOfExpr` counted the `/` inside the `a/b` fraction literals as a
  DIVISION operator, so *every* fraction expression looked `MIXED`, and the
  `FRACTION_ARITH` branch coerces `MIXED → 'ADDITION'`. A correct subtraction
  word problem ("Tùng lấy của An 4/5…") then tripped
  `SEMANTIC_STRUCTURE_MISMATCH` ("prose reads as SUBTRACTION but kernel is
  ADDITION") → `DETERMINISTIC_WRONG` → retries exhausted → `FAILED`.
- The model's math was right the whole time; the kernel's own operation label
  was wrong.

### FREE fix (`main` Phase-4 commit)

- **`math-kernel.ts` `deriveSemantics` / `FRACTION_ARITH`** — strip `\d+/\d+`
  fraction literals before reading the connecting operator. `3/9 - 4/5` →
  `# - #` → `SUBTRACTION`; `2/3 : 4/5` → `DIVISION`; `7/9 + 2/3` → `ADDITION`.
- **`kernel-validator.ts` `answersEqual`** — a defensive companion fix: an
  `exact`-kind answer string (`"-7/15"`) that equals a `fraction` / `numeric`
  kernel answer is now parsed and compared as an exact rational instead of
  falling through to `false` (`ANSWER_MISMATCH`). Tightens correctness, does not
  loosen any gate.
- 2 new `kernel-integrity` regression tests (fraction-operator derivation over
  400 probes; exact-string-vs-fraction-kernel equality).

### Offline re-validation — NO paid calls (`phase4-offline-rescore.test.ts`,
report `docs/implementation/data/66_phase4_offline_rescore.txt`)

Re-derived every kernel and re-ran `composeExercise` + `validateAgainstKernel`
over all **780 captured last-attempt realizations** from the Phase 4 raw sidecar:

| after the fix | result |
|---|---|
| still `DETERMINISTIC_WRONG` | **0** |
| previously-`FAILED` slots now kernel-consistent | **7 of 9** |

The 7 recovered slots were all the same defect (FRACTION_ARITH subtraction /
division word problems mislabelled ADDITION). The **2 residual failures** are
`BENCH-LT-G7-05::item-03` — the parallel-lines `compare_and_decide` Group-C
reasoning item already seen in Phase 3. So the corrected pipeline would have run
Phase 4 at **~96–97% full-worksheet completion** with the only residue a single
hard reasoning structure (P2, Phase 8).

### Residual 2 failures — a second FREE fix (`main` Phase-4b commit)

`BENCH-LT-G7-05::item-03` is `M7.GEO.PARALLEL_CRITERIA`, **`answerKind: choice`**
(a yes/no "are these lines parallel?" reasoning item), no kernel. In passes 1–2
the model generated a **"tìm x" numeric angle problem** instead — right maths,
wrong item *type*. `composeExercise` correctly rejected it ("choice item — need a
correct answer plus a distinct distractor"), but the orchestrator **discarded
compose's `regenerationInstruction`** and the retry re-ran with no correction →
same drift → `FAILED`. (By pass 3 the model happened to produce a valid choice
item on its own.)

Fix:
- **`worksheet-orchestrator.ts`** — a `COMPOSE` failure now threads
  `composed.regenerationInstruction` into `s.retryInstruction` (+ `retryReason
  'SCHEMA'`), so the retry gets the deterministic correction instead of a blind
  re-roll.
- **`compose.ts`** — the `choice` regeneration instruction is now explicit that
  the item must be multiple-choice, *not* a "tìm x" / compute problem.
- 1 orchestrator regression test (SCHEMA fault → COMPOSE fail → corrective retry
  → `READY` on attempt 2).

This closes the mechanism that produced the 2 residual failures. A live re-run
would confirm the rate, but the P0/P1 exit gates (kernel correctness 100%, 0
silent contradiction, 0 validator-FP acceptance) are met and the generation
budget is nearly exhausted ($1.91 / $2.00) — Phase 4 continues into Phase 5.

**799 unit tests / 0 fail. tsc clean.** Pre-existing lint debt on `main`
(unrelated files) unchanged — flagged as a background task.

---

## PHASE 5 — GROUP C CROSSCHECK IMPLEMENTATION  ✅  (`main` Phase-5 commit)

`openai-answer-crosscheck.ts` — `createOpenAiAnswerCrosscheck(AIProviderAdapter)`:
the VERIFIER, logically independent of the generator (sees only prompt + answer
+ short solution summary + grade — never hints / rubric / chain-of-thought).
Strict JSON `{verdict, confidence, reason}`; an unparseable or errored response
is `UNCERTAIN`, **never PASS**. Returns usage for cost telemetry.

- `runGroupCCrosscheck` retries the verifier **once** on `UNCERTAIN` before the
  review queue; returns every call's usage.
- `orchestrateWorksheet` folds crosscheck usage into `WorksheetTotals.byModel`
  with `operationType: 'advanced_verification'`; `worksheetTraceToUsageEvents`
  emits the right operation per model.
- `resolveWorksheetGeneration`'s `buildPaid` factory = `createOpenAiAnswerCrosscheck`
  over a `gpt-4.1-mini` adapter (`CROSSCHECK_MODEL` overridable) — used **only**
  when `AI_CROSSCHECK_MODE=LIVE` (+ key).

7 new tests (mock `AIProviderAdapter`: PASS/FAIL/UNCERTAIN parse, retry-once,
provider-throw → UNCERTAIN, verifier isolation). No paid call.

---

## PHASE 6 — SMALL PAID GROUP-C VERIFICATION  ⛔  STOPPED — 3 false PASSes → FREE v2 fix → awaiting a re-run decision

`groupc-crosscheck-golden.ts` — **20 items** (8 PASS, 9 FAIL, 3 UNCERTAIN), each
with a Claude-drafted GOLDEN verdict incl. 2 G7 parallel-lines cases.
`groupc-crosscheck.live.test.ts` ran the real `createOpenAiAnswerCrosscheck`
(gpt-4.1-mini) — **22 verifier calls, ~$0.01 spend** (harness NaN'd the spend
line; token counts small — fixed for the re-run). Reports:
`docs/implementation/data/66_groupc_xcheck_v1_{report.txt,raw.jsonl}`.

| | v1 result |
|---|---|
| PASS agreement | 8/8 |
| FAIL agreement | 6/9 |
| UNCERTAIN | 2/3 (gc12 → FAIL, safe) |
| **FALSE PASS** | **3 — HARD FAIL** |

**The 3 false PASSes:**
- `gc04` (find-the-error, fix `846 + 108 = 944` is wrong) — the verifier
  self-solved to 954, **wrote the correct value in its own reason**, then output
  `verdict: PASS`. Verdict/reason inconsistency.
- `gc07` (ratio 60 @ 2:3, answer states parts 20 & 30) — the verifier's reason
  literally says *"đáp án … là sai"*, verdict `PASS`. Verdict/reason
  inconsistency.
- `gc19` (G7: equal **co-interior** angles wrongly used to conclude parallel) —
  the verifier restated the flawed rule and accepted it. A genuine reasoning
  miss by gpt-4.1-mini on a T3 geometry criterion.

### FREE fix — `openai-answer-crosscheck.v2` (`main` Phase-6 commit)

- The verifier prompt now forces a **structured, ordered** output:
  `ket_qua_ban_tu_giai` (its own independent result) → `ket_qua_trong_dap_an`
  (the result the answer claims) → `loi_sai_phat_hien` (any error found) →
  `verdict`. `PASS` is defined as *only* when it self-solved, the two results
  match exactly, and no error was flagged.
- **Deterministic guards in `parseVerdict`**: a `PASS` is overridden to `FAIL`
  when the verifier's own output contradicts it — `loi_sai_phat_hien` is
  non-empty, or `ket_qua_ban_tu_giai` and `ket_qua_trong_dap_an` are both
  numeric and unequal. This catches the `gc04` / `gc07` classes structurally.
- `maxTokens` 700 → 900 for the extra fields. 3 new guard regression tests.
- Harness: real spend via `tokenCostUsd`; per-item raw sidecar.

`gc19` (geometry-criterion reasoning) is **not** covered by the numeric guards —
the v2 "check every reasoning step, flag any error" instruction *may* catch it,
but confirming that needs a re-run. If it persists, the options are a
**product/architecture decision, not autonomous**: route `M7.GEO.*` / proof
crosscheck to `gpt-5-mini`, or always send geometry-criterion reasoning to human
review.

### STOP

Per the mandatory boundary ("if any false PASS: STOP"), I did not wire crosscheck
into staging shadow and did not proceed to Phase 7. A **re-run of the paid
Phase 6 with v2** (est. ~$0.02, well inside the remaining ~$0.49 crosscheck
budget) is the next step — it needs a go-ahead since the first run failed the
hard gate.

---

## PHASE 7 — STAGING FULL PATH  ⏳

_(blocked on a clean Phase 6)_

---

## PHASE 8 — CONTENT QUALITY HARDENING  ⏳

_(pending; P2 candidates already logged: FRACTION_ARITH reasoning-structure
generation, `choice`-kind drift on geometry skills — the compose-retry fix in
Phase 4b is the first of these)_

---

## PHASE 9 — INTERNAL LIVE READINESS  — STOP HERE (do not enable LIVE)

_(pending)_
