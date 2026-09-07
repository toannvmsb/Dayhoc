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

## PHASE D7 — FINAL CONFIRMATION COHORT  ⏸  STOP — needs an explicit generation budget

`d7-confirmation-cohort.live.integration.test.ts` is **built** (`RUN_D7=1` +
`D7_GEN_CAP_USD` required — the run refuses to start without an explicit budget).
~30 synthetic worksheets through the full staging path with the **real Luna
generator**, covering G4 + G7 · arithmetic · fractions · word problems ·
LINEAR_EQ · frontier (above-grade) · reasoning · Group C · geometry. Persists a
`D7_COHORT.txt` report and asserts the hard exit gates (kernel correctness 100%,
0 wrong accepted, 0 silent semantic contradiction, bounded retry, spend ≤ caps).

**Why STOP:** D7 is **paid generation**, and the autonomous generation budget
($2.00) is at **$1.9087** — ~$0.09 left. ~30 real worksheets ≈ **$0.60–0.90**.
Per the directive ("if a new paid generation budget is required, STOP and
request it before running"), this is a mandatory boundary.

**Request:** an explicit `D7_GEN_CAP_USD` (≈ **$1.00** covers ~30 worksheets with
headroom) for the confirmation cohort. Crosscheck for D7 stays inside a $0.25
sub-cap of the existing $0.50 crosscheck budget (~$0.07 spent so far).
