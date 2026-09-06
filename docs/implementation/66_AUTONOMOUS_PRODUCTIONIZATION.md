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

## PHASE 4 — EXTENDED SHADOW  ⏳  (running)

Same harness, `WS_SMOKE_PASSES=3` `WS_SMOKE_TAG=_EXT` `WS_SMOKE_DAILY_USD=1.50`
(the remaining generation budget) — ~78 runs, the `DailyCostGuard` stops it at
$1.50. Tests **consistency across repeated generation** of the same 26 specs and
whether the Phase 3 P2 failures repeat.

_(results pending)_

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

## PHASE 6 — SMALL PAID GROUP-C VERIFICATION  ⏳  (harness ready)

`groupc-crosscheck-golden.ts` — **16 synthetic reasoning / find-the-error /
construct-an-example items**, each with a Claude-drafted GOLDEN verdict (6 PASS,
8 FAIL, 2 UNCERTAIN). `groupc-crosscheck.live.test.ts` (`RUN_GROUPC_XCHECK=1`,
cap $0.50) runs the real `createOpenAiAnswerCrosscheck` (gpt-4.1-mini) against
it. **HARD requirement: false PASS = 0.**

_(pending Phase 4)_

---

## PHASES 7–8

_(pending)_

---

## PHASE 9 — INTERNAL LIVE READINESS  — STOP HERE (do not enable LIVE)

_(pending)_
