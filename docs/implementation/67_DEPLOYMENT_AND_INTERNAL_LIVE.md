# 67 — DEPLOYMENT & INTERNAL LIVE READINESS (D1–D7)

> Real staging deployment against the Supabase project, then the Internal LIVE
> readiness gate. AI generation architecture is LOCKED (doc 66). LIVE stays OFF.
>
> **Locked:** generator default `gpt-4.1-mini` · high-complexity/frontier/fallback
> `gpt-5-mini` · Group-C verifier `gpt-4.1-mini`, geometry/proof `gpt-5-mini` ·
> no `gpt-4o-mini` in production · MathKernel + validator authoritative.

---

## PHASE D1 — REAL STAGING INFRASTRUCTURE  ⏸  STOP — one manual value needed

### Audit of what already exists

Supabase project **`yribgnhfxgvyiducukgy`** (org "EchToan"), created 2026‑09‑05.
All checks below were run from the local machine against the real project.

| capability | state | evidence |
|---|---|---|
| Supabase **Auth** | ✅ reachable | `GET /auth/v1/health` → 200; `resolveAuthAdapter(process.env)` → `kind: "supabase"` |
| Private **Storage** | ✅ ready | bucket `dayzi-evidence` exists, `public: false`; `resolveUploadStorageAdapter` → `SupabaseStorageAdapter` |
| Service secrets in `.env` (gitignored) | ✅ present | `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Staging **PostgreSQL** schema | ❌ **empty** | every table (`users`, `evidence`, `pgmigrations`, `worksheet_generation_runs`, `ai_usage_events`, …) → PostgREST 404; **0 of 24 migrations applied** |
| Staging Postgres **connection string** | ❌ **not available** | `DATABASE_URL` in `.env` points at the local portable Postgres; the Supabase DB password is not in the environment and cannot be read from the dashboard by tooling |
| Deployed web/API host | ⚠️ none | no `Dockerfile` / `vercel.json` / `fly.toml`. **Not required for D3–D7** — migrations + the D3/D6/D7 integration tests run locally against the staging Postgres with synthetic accounts. A deployed host is a separate, later step for real browser/pilot traffic. |
| `apps/web` worksheet-generation wiring | ✅ automatic | `apps/web/lib/server/api.ts` calls `createProductionApi` without injecting `worksheetGeneration`; `production-api.ts` then auto-resolves it from env via `resolveWorksheetGeneration` — so `AI_GENERATION_MODE=SHADOW` in the staging env activates it |
| Migration ↔ Supabase compatibility | ✅ expected OK | only `pgcrypto` is `CREATE EXTENSION`d (Supabase pre-installs it); `SET session_replication_role = replica` in migration `1757635200000` + the deletion workflow is session-local and permitted for Supabase's `postgres` role |

### 🔴 STOP — the one manual action

**Everything is in place except the staging Postgres connection string.** I need
it to run the 24 migrations and to point the D3/D6/D7 tests at the real database.

1. **Open:** Supabase dashboard → project **`yribgnhfxgvyiducukgy`** → **Project
   Settings → Database → "Connection string"**.
2. **Copy:** the **Session pooler** URI (`Mode: Session`, port `5432`) — it looks
   like
   `postgresql://postgres.yribgnhfxgvyiducukgy:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with the database password you set when you created
   the project (Settings → Database → "Database password" → *Reset* it if you no
   longer have it — resetting is safe, nothing is using it yet).
3. **Value required:** that full URI, password included.
4. **Where to store it:** add a new line to the repo-root **`.env`** (gitignored —
   never in source):
   ```
   STAGING_DATABASE_URL=postgresql://postgres.yribgnhfxgvyiducukgy:...@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   Keep the existing `DATABASE_URL` (local Postgres) unchanged — the D‑phase
   runners will use `STAGING_DATABASE_URL` explicitly so local dev and the local
   integration suite keep working.

Once `STAGING_DATABASE_URL` is in `.env`, I continue automatically: run the 24
migrations against staging, then D2–D7.

_(nothing else is blocked — Auth, Storage, Resend, OpenAI all verified working)_

---

## PHASE D2 — DURABLE WORKSHEET QUEUE  ✅  (`main` D2 commit; FREE, local Postgres)

`migrations/1758585600000_worksheet_job_queue.js` — **`worksheet_jobs`** (mutable):
`dedup_key UNIQUE` (idempotent enqueue), `state` PENDING/CLAIMED/DONE/FAILED,
`attempts`/`max_attempts`, `available_at` (retry backoff), `claimed_by` +
`lease_expires_at` (crash recovery), `run_id` on DONE, `last_error` (category
only — never content). up/down/up verified.

`@copilot/exercise-gen/worksheet-job-queue.ts`:
- **`PgWorksheetJobQueue implements WorksheetShadowQueue`** — `enqueue` persists
  ONLY the serializable slice (`spec` + mode + refs + config); `ON CONFLICT
  (dedup_key) DO NOTHING`. Non-serializable deps (generators, adapters, stores)
  are rebuilt per job by the worker.
- **`WorksheetJobWorker`** — claims one job with `FOR UPDATE SKIP LOCKED`, runs
  `runWorksheetShadow`, moves it to DONE / FAILED / back to PENDING (bounded
  retry + backoff). A crashed worker's CLAIMED job is reclaimed once its lease
  expires. `start()` / `stop()` / `runToIdle()`.

`services/api`: `WORKSHEET_QUEUE=durable` → `PgWorksheetJobQueue`;
`createWorksheetJobWorker()` builds a worker on the **same locked routing + gates**
as the in-process path (`buildGenerationDeps` extracted + shared).

**4 integration tests, real Postgres, no paid AI:** idempotent enqueue ·
restart recovery (fresh worker finishes an abandoned job, exactly one
`worksheet_generation_runs` row per spec — no double-serve) · lease-steal (two
workers, no concurrent double-process) · bounded retry (FAILED after
`max_attempts`, no infinite loop).

---

## PHASE D3 — REAL POSTGRES / STORAGE / AUTH  ✅  (`main` D3 commit)

`STAGING_DATABASE_URL` = the Supabase **Session pooler** (Seoul / `ap-northeast-2`,
Postgres **17.6**). `scripts/staging.mjs` runs any command against it
(`PGSSLMODE=no-verify`, never prints the URL).

- **24 migrations** ran clean against staging (76 tables, 34 append-only
  triggers, `pgcrypto` + `uuid-ossp`; `SET session_replication_role = replica`
  and `CREATE EXTENSION` are both permitted for Supabase's `postgres` role).
- **Full production DB integration suite passes against staging** — 16 files /
  ~72 tests: generation persistence, review queue, `ai_usage_events` ledger,
  entitlements, hard-deletion purge, upload ingestion, exam intelligence,
  e2e-security, the durable job queue.
- **Real Supabase Auth** (`supabase-live.integration.test.ts`, `RUN_LIVE_SUPABASE=1`):
  `createUser` → `signInWithPassword` → `verifyToken` (JWKS) round-trips; a
  garbage token → `null`; user hard-deleted in teardown. **PASSED.**
- **Real Supabase private Storage** (`supabase-storage-live.integration.test.ts`):
  `put` → server-mediated `getBytes` (exact bytes) → the public object URL fails
  (bucket `dayzi-evidence` is private) → `remove` → `getBytes` fails. **PASSED.**
- **Audit:** ZERO `SERVICE_ROLE` / `SUPABASE_JWT_SECRET` / `NEXT_PUBLIC_`
  Supabase references in `apps/web` (outside `lib/server` + `app/api`) or
  `apps/mobile`. The client holds only a bearer JWT; storage retrieval is
  server-mediated.

---

## PHASE D4 — REVIEWER PATH  ✅  (`main` D4 commit; FREE)

- `production-api.ts` — **`reviewQueueListPending(ctx)`** (ADMIN-only; returns
  PENDING items **with** the short-retention QA snapshot) and
  **`reviewQueueResolve(ctx, itemId, decision)`** (ADMIN-only; APPROVED /
  REJECTED / REGENERATE_REQUESTED; one-time PENDING→resolved transition guarded
  in `PgReviewQueueStore`). The `review_queue` row is the audit record:
  `resolved_by` (pseudonymous reviewer), `resolved_at`, final `state`.
- `apps/web/lib/server/rest.ts` — ADMIN workspace + `adminCtx()` (server-derived,
  403 unless the caller holds the ADMIN role via `sessionContext`) +
  `GET /admin/review-queue`, `POST /admin/review-queue/:id/resolve`,
  `GET /admin/worksheet-shadow`.
- Integration test: ADMIN list + resolve-once + non-admin refused +
  double-resolve rejected + reviewer id pseudonymised.

---

## PHASE D5 — GROUP-C STAGING CROSSCHECK  ✅  (`main` D5 commit; paid crosscheck $0.006)

`d5-staging-crosscheck.live.integration.test.ts` (`RUN_D5_STAGING=1`, sub-cap
$0.20): 6 SHADOW worksheets (mock generator → free) × the **real routed
verifier** (`createRoutedAnswerCrosscheck`: gpt-4.1-mini + gpt-5-mini geometry),
persisted to staging Postgres.

- 6 Group-C items, all verdict **PASS → slot READY but `productionReady` STAYS
  false** (AI-verified ≠ deterministic).
- 6 real verifier calls; `ai_usage_events` `advanced_verification` rows
  persisted; **$0.0058** spend.
- UNCERTAIN → PENDING_CROSSCHECK + one `CROSSCHECK_UNCERTAIN` review row, never
  PASS — asserted (0 UNCERTAIN this run; the path is covered by the Phase 6
  golden + mock unit tests).

## PHASE D6 — FULL PRODUCTION-PATH STAGING TEST  ✅  (`main` D6 commit; paid $0.005)

`d6-staging-full-path.live.integration.test.ts` (`RUN_D6_STAGING=1`): the WHOLE
path against staging with the **durable queue** —

Parent `getToday` → planner → `ExerciseGenerationSpec` → **`PgWorksheetJobQueue`
(job PENDING, not run inline)** → a SEPARATE **`WorksheetJobWorker.runToIdle()`**
→ orchestrator → MathKernel/validator/routing/retry/fallback/last-resort → LIVE
routed Group-C crosscheck → review queue → **`worksheet_generation_runs` /
`_slots` / `_slot_attempts`** in staging Postgres → `ai_usage_events` → ADMIN
`worksheetShadowObservability`.

- Parent / Student / Teacher API responses **byte-identical** SHADOW vs OFF.
- **0 PII** in any slot / attempt / job row.
- **Child deletion purges `worksheet_jobs` + `worksheet_generation_runs` +
  `worksheet_slots/attempts` + `review_queue` by the pseudonymous `child_ref`.**

### Deletion-completeness fix (found by D6)

The worksheet SHADOW path mints its own `egs_*` `generation_spec_id` and never
writes `generation_specs`, so the pre-D6 deletion purge
(`generation_spec_id IN (SELECT id FROM generation_specs WHERE child_id = $1)`)
was a **no-op** for `worksheet_generation_runs` / `review_queue` — those rows
**survived a child deletion**. Fixed: the deletion workflow now purges those
tables (and `worksheet_jobs`) by `child_ref = sha256(childId).slice(0,16)` — the
value `resolveWorksheetGeneration.resolveChildRef` stores — plus a spec-id
fallback for review rows whose own `child_ref` was null. The local deletion test
was rewritten to use the real pseudonymisation and actually assert the rows are
gone (it was vacuous, and `confirmChildDeletion`'s ack arg was wrong — it takes
the name string, not `{acknowledgement}`, so the old test never deleted
anything).

---

## PHASE D7 — FINAL CONFIRMATION COHORT  ⏸  STOP — completion gate FAILED; needs a decision + a fresh budget

`d7-confirmation-cohort.live.integration.test.ts` — ~30 synthetic worksheets
through the full staging path with the **real Luna generator**, covering G4 + G7
· arithmetic · fractions · word problems · LINEAR_EQ · frontier · reasoning ·
Group C · geometry. Persists `D7_COHORT.txt`, asserts the hard *safety* gates.

### Run 1 (2026-09-07, `D7_GEN_CAP_USD=1.00`, 30 worksheets)  — commit `b8e7002`

| Gate | Result |
|---|---|
| kernel deterministic correctness | **100.0%** (162/162) ✅ |
| kernel item accepted WRONG | **0** ✅ |
| silent SEMANTIC_UNKNOWN accepted | **0** ✅ |
| Group-C false PASS (UNCERTAIN never → PASS) | **0** ✅ (3 PENDING_CROSSCHECK, 3 REVIEW) |
| max attempts / slot | **5** (≤ 6) — bounded ✅ |
| no duplicate worksheet | **1 run / spec** ✅ |
| spend | gen **$0.6478** / $1.00 · xcheck **$0.0526** / $0.25 ✅ |
| **full worksheet completion** | **0/30 (0.0%)** ❌ — hard fail vs the ≥99% (30/30) gate |

Recovery paths (243 items): FIRST_PASS 109 (44.9%) · AFTER_RETRY 33 (13.6%) ·
AFTER_FALLBACK 12 (4.9%) · AFTER_LAST_RESORT 8 (3.3%) · AFTER_CROSSCHECK 35
(14.4%) · REVIEW_REQUIRED 3 (1.2%) · **FAILED 43 (17.7%)**. avg 1.63 attempts/item.
cost/item $0.00267 · cost/worksheet $0.020. model share 48.6% mini / 51.4%
5-mini. slot p50/p95 8.1s / 29.6s · sheet p50/p95 63s / 145s.

**All safety gates pass — nothing wrong was ever served.** The blocker is the
**completion gate**: every worksheet was marked `FAILED` because the orchestrator
sets `worksheetState = failedSlots > 0 ? 'FAILED'` — one failing slot fails the
whole sheet (the 7 good items and a `review_queue` row for the 8th are still
persisted).

### Run 2 — diagnostic (`D7_GEN_CAP_USD=0.30`, 12 worksheets)  — commit `320348c`

Captured `failure_category` before the staging purge. **The exact failure path:**

- **25 of ~42 failed-slot attempts = `CURRICULUM_OR_LEVEL`.** Root cause: the
  synthetic specs hard-coded `difficulty { kMax: K3, tMax: T4 }` for **every**
  axis. The generator then produces a *correct* K5 frontier / T5 thinking-
  challenge item and the validator rejects it as out-of-envelope. The real
  planner's `deriveDifficulty` lifts `kMax` to the FRONTIER target's ceiling and
  `tMax` to T5 for an advanced `parentGoal` — **a fixture bug, not a pipeline
  defect.**
- 14 of 17 FAILED slots were `NO_KERNEL` (frontier / geometry / thinking) with
  `initial_role: HIGH_COMPLEXITY` — no deterministic last-resort exists for
  non-Group-A families, so they terminate `FAILED` after retry + escalation.
- Residual genuine model-quality failures (minority): `COMPOSE` 6 (geometry
  multiple-choice item generated as a numeric "tìm x"), `RAW_LATEX` 3 (model
  emits `\frac` despite the corrective instruction), `CROSSCHECK_FAIL` 3,
  `SIMILARITY_OR_DUPLICATE` 2.

### Fix + Run 3 — targeted re-validation (`D7_GEN_CAP_USD=0.09`, `D7_AXES=g7_frontier,g7_geometry,g4_reasoning`)  — commit `320348c`

Fixture fix: `specForAxis` now derives a per-axis envelope consistent with its
buckets (frontier → `kMax K5`; thinking → `tMax T5`; advanced `parentGoal`), and
the distribution was corrected to **1 hard slot / worksheet** to match the real
planner mix (`78e04ae`).

Result on the two hardest axes: **`CURRICULUM_OR_LEVEL` dropped from 25 → 3**
(absolute), safety gates still 100% / 0 / 0. But **frontier and geometry
worksheets still `FAILED`** — residual `SIMILARITY_OR_DUPLICATE` (3, narrow
`M7.ALG.SYMMETRIC` frontier content), `RAW_LATEX` (1), `COMPOSE` (1),
`CROSSCHECK_FAIL` (1) still put ≥1 slot/worksheet into `FAILED`.

### Where this leaves INTERNAL_LIVE_READY

`INTERNAL_LIVE_READY = false`. **Exact blocker:** the ≥99% "full worksheet
completion (30/30)" gate is unreachable while **(a)** the orchestrator hard-fails
an entire worksheet on any single failed slot **and (b)** residual per-slot
failure on the hardest above-grade / geometry-multiple-choice / LaTeX-suppression
content is non-zero and not deterministically recoverable (no kernel → no
last-resort). Every failed slot already produces a `review_queue` row, so no
child is ever shown a broken or wrong item — the failure is a *label*, not a
served defect.

**Two mutually-exclusive decisions are needed from anh (either unblocks D7):**

1. **Partial-worksheet delivery semantics.** Change `worksheetState` so a sheet
   with ≥1 accepted slot and the rest routed to REVIEW is `READY_WITH_REVIEW`
   (delivered: N good items now + the gaps tracked for a reviewer), and
   redefine the completion gate as "≥ 99% of *items* land READY or REVIEW, 0
   silently wrong". This is a **product/architecture decision** (MVP loop + doc
   65 §8) — Claude will not make it unilaterally.
2. **Keep strict semantics**, accept that "full worksheet completion" as defined
   will sit around the first-pass-clean rate (~40–60% of worksheets in run 1),
   and treat the review queue as the operational completion path. Internal LIVE
   then gates on *item* completion + review-queue throughput instead.

**Also required before a real 30-run:** a fresh `D7_GEN_CAP_USD` — the approved
$1.00 was consumed by runs 1–3 ($0.976 total). ~$1.00 more covers a clean 30-run
under the chosen semantics.

### Spend to date (D7)

generation **$0.976** / $1.00 approved · crosscheck **$0.089** / $0.25 sub-cap.
Cumulative session generation spend **$2.885** (autonomous $1.909 + D7 $0.976);
cumulative crosscheck **$0.164** / $0.50.
