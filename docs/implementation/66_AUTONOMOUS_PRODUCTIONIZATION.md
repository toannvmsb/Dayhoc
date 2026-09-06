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

## PHASE 3 — INTERNAL SHADOW SMOKE  ⏳  (running)

`packages/testing/src/benchmark/worksheet-shadow-smoke.live.test.ts`
(`RUN_WS_SMOKE=1`): ~26 synthetic worksheets · real `orchestrateWorksheet` ·
gpt-4.1-mini + gpt-5-mini · last-resort ON · crosscheck OFF · per-worksheet cap
$0.05 · cumulative daily cap $2.00 · raw sidecar `WS_SMOKE_raw.jsonl` (no PII).

**STOP condition**: any kernel item accepted with a wrong answer, or any silent
`SEMANTIC_UNKNOWN` acceptance → test fails, P0/P1.

_(results pending)_

---

## PHASE 4 — EXTENDED SHADOW  ⏳

_(pending Phase 3)_

---

## PHASES 5–8

_(pending)_

---

## PHASE 9 — INTERNAL LIVE READINESS  — STOP HERE (do not enable LIVE)

_(pending)_
