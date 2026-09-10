# 70 — SMALL FAMILY PILOT PREPARATION

> Anh's directive, 2026-09-08. Baseline: doc 69 Wave 1 EXECUTED
> (`WAVE1_PASS=true`, `READY_FOR_SMALL_FAMILY_PILOT`). The generation
> architecture and model routing are **LOCKED** — this phase does NOT touch them.
>
> Goal: a real, invited **2–3 family** pilot (~1–2 children/family, 5–7 days).
> **No public signup. No billing. No automatic cohort expansion.** Every pilot
> family is on an explicit allowlist and has recorded guardian consent before a
> real child sees AI-generated content.

**This is preparation. Real families are NOT enrolled by this work.** Enrolling a
real family and standing up the external host are MANDATORY STOP points (§13).

---

## 1. Pilot cohort — reuses `internal_live_cohort`

No new auth. A **pilot family** is a cohort row with:

| column | pilot value | meaning |
|---|---|---|
| `kind` | `'pilot'` | funnel/dashboard marker; auth logic unchanged |
| `consent_required` | `true` | LIVE content is withheld until guardian consent is on file |
| `wave` | `2` | pilot wave |

`resolveEffectiveGenerationMode` (doc 69) is unchanged — a pilot family is LIVE
iff `AI_GENERATION_MODE=LIVE` **AND** kill switch OFF **AND** the family ref is in
the cohort. The consent gate is an **additional** check at serving time (§4).

- `addPilotFamily(pool, familyRef, {note, actorRef})` · `listPilotFamilies` ·
  `familyRequiresConsent` — `services/api/src/production/pilot.ts`.
- Admin: `pilotFamilyAdd` / `pilotFamilyList` · `POST /admin/pilot/cohort` ·
  `GET /admin/pilot/cohort`.
- Refs are `sha256(id).slice(0,16)` — same function as internal LIVE, so a family
  already added to the internal cohort keeps working; `addPilotFamily` just
  upgrades the row's `kind`/`consent_required`.

## 2. Deployment — a persistent externally-reachable environment

**Audit result: NO suitable host exists in this repo.** Everything so far has run
on the local dev box (`scripts/dev-pilot.sh` supervisor) against a local or
Supirbase staging DB. A real pilot needs a host that is up when anh's laptop is
not. The artifacts below are built and committed; **standing up the host is a
STOP-for-hosting action (§13)** — the exact manual steps are in
`§Deploy — remaining manual actions`.

Built this phase:

| artifact | purpose |
|---|---|
| `Dockerfile` | one image, two entrypoints (API host / worker) + crons |
| `services/api/src/bin/worksheet-worker.ts` (`npm run worker:worksheet`) | long-lived durable `WorksheetJobWorker` — LIVE cohorts must NOT use the in-process queue |
| `scripts/pilot-cron-safety.mjs` (`npm run cron:pilot:safety`) | `enforceSafetyAutoStop` every ~10 min → flips DB kill switch on any CRITICAL signal |
| `scripts/pilot-cron-maintenance.mjs` (`npm run cron:pilot:maintenance`) | daily `purgeExpiredQaSamples` + `purgeStaleServingIntents` |
| `package.json` scripts | `start:web`, `worker:worksheet`, `cron:pilot:safety`, `cron:pilot:maintenance` |

The worker refuses to boot (exit 3) if the config would make it a no-op
(`AI_GENERATION_MODE=OFF` / no `OPENAI_API_KEY` / blocking staging config) so a
supervisor surfaces the misconfig.

## 3. Guardian consent (doc 70 §4, P-05)

`consent_records` is an **append-only ledger** (P-05 triggers reject UPDATE/DELETE).
A pilot consent is one INSERT; a withdrawal is a **new** row with `withdrawn_at`
set (never an UPDATE). "Has consent" = the most-recent row for
`(child, purpose, processor)` is a grant.

- `PILOT_CONSENT` — purpose `ai_generated_learning_content_pilot`, processor
  `openai`, `policy_version = 'pilot-2026-09'`, categories
  `learning_evidence / practice_attempts / ai_generated_content /
  short_retention_qa_sample`.
- `recordPilotConsent(pool, {childId, grantedByUserId})` ·
  `hasPilotConsent(pool, childId)` ·
  `withdrawPilotConsent(pool, childId, withdrawnByUserId)`.
- Parent: `recordPilotConsent` / `withdrawPilotConsent` / `pilotConsentStatus` ·
  `POST/DELETE/GET /children/:id/pilot/consent`.
- **Enforcement**: `serveLiveWorksheetIfPending` — if the family's cohort row has
  `consent_required=true` and there is no active consent, the pending LIVE
  worksheet is marked `SKIPPED` (`skip_reason: 'pilot: no guardian consent'`) and
  nothing is served. The child still gets the legacy reference-library worksheet.
  Verified in `pilot.integration.test.ts §4`.
- The pilot onboarding copy (product UI, not built here — a screen task) must
  explain: content is AI-generated, what data is used, that a small sample is
  QA-reviewed with 7-day retention, the deletion right, and that this is a pilot.
  **No legal claims beyond the existing product policy.**

## 4. Parent feedback (doc 70 §5)

`parent_feedback` — **append-only** (ledger triggers), one row per submission.

- Verdicts: `SUITABLE · TOO_EASY · TOO_HARD · WRONG_CURRENT_TOPIC ·
  ALREADY_MASTERED · CONTENT_QUALITY_ISSUE · OTHER`.
- Each row may carry a **hypothesis** string (e.g. `TOO_HARD` → "content may be
  above the child's level — check K/T targets + prerequisite readiness"). The
  hypothesis is **advisory for a reviewer**. It is **NEVER auto-applied to
  mastery** — verified in `pilot.integration.test.ts §5` (mastery row count is
  unchanged by a feedback event).
- Parent: `submitParentFeedback(auth, childId, {verdict, note?, assignmentId?})` ·
  `POST /children/:id/pilot/feedback`. Optional, low-friction, one tap.
- `feedbackRollup(pool, sinceIso?)` → `{total, byVerdict, hypotheses}` ·
  `GET /admin/pilot/feedback`.

## 5. Product metrics (doc 70 §6)

Pseudonymous event log `pilot_activity` (`family_ref` / `child_ref` only, event
name + small operational `meta` — **no question/answer/evidence content**).

| bucket | events |
|---|---|
| activation | `profile_created`, `today_viewed`, `first_worksheet_generated` |
| engagement | `worksheet_open`, `practice_started`, `practice_completed` |
| conversion | worksheet→practice, practice completion (derived) |
| retention | D1 / D3 / D7 return families (derived from event days) |
| parent value | `plan_accepted` / `plan_edited` / `plan_skipped`, feedback rollup |
| learning loop | practice→evidence→gaps→Twin recompute counts |

`pilotDashboard(pool, {sinceIso?})` → `PilotDashboard` (privacy-safe — asserted
in tests, no prompt/solution strings). Admin: `pilotDashboard` ·
`GET /admin/pilot/dashboard`.

Wiring points (production-api): `getToday` → `today_viewed`; serving →
`first_worksheet_generated` + `practice_started`; `getAssignmentDetail` →
`worksheet_open`; `submitPractice` → `practice_completed`; `createChild` →
`profile_created`; `submitParentFeedback` → `feedback_submitted`.

## 6. Safety gates (unchanged, always-on)

`WRONG_ACCEPTED = 0` · `UNSAFE_DELIVERY = 0` · `FALSE_CROSSCHECK_PASS = 0` ·
`SILENT_SEMANTIC_CONTRADICTION = 0` · `VERIFIED_DELIVERY_RATE = 100%` ·
`CORE_WORKSHEET_DELIVERY_RATE ≥ 99%`. The `pilot-cron-safety` cron runs
`enforceSafetyAutoStop` — any CRITICAL signal flips the DB kill switch with **no
human approval and no redeploy** (doc 69 §4). Only verified `READY` items are
ever turned into an assignment (`servableItemsOf` — defence in depth).

## 7. QA sampling for real families (doc 70 §9)

`shouldSampleQa(result, runId, env)` (`internal-live-serving.ts`) — **event-
triggered** on any degraded path (safe substitution / optional omission /
crosscheck-uncertain / review-required / high retry), plus a base-rate random arm:

- pilot: `PILOT_QA_SAMPLE_RATE` (default **0.08**, i.e. 8%).
- internal LIVE (no pilot rate set): `INTERNAL_LIVE_QA_SAMPLE_ONE_IN` (default 5).

Retention stays **7 days** (`INTERNAL_LIVE_QA_RETENTION_DAYS`, capped 30 —
**not increased**). Reads are access-logged (`readQaSample`), reviewer-authed
(ADMIN), integrated with child deletion (`purgeInternalLiveForChild` +
`purgePilotForChild`), and **excluded from analytics**.

## 8. Known quality concerns to watch (NOT to auto-optimise)

Per §8 — **do NOT run broad prompt/model optimisation**. Watch with real pilot
evidence + the QA queue:

- `M7.ALG.SYMMETRIC` similarity (symmetric-expression framings).
- geometry `explain_or_justify` items (choice-vs-numeric answerKind).
- thinking-challenge variety (`OPTIONAL_REASONING` slot).
- optional omission / safe-substitution rate — if core substitution is high, the
  content is being *degraded* to hit the completion bar; flag, don't hide.

## 9. Daily pilot ops checklist

1. `GET /admin/internal-live/kill-switch` — expect `active:false`.
2. `GET /admin/pilot/dashboard?sinceIso=<24h ago>` — funnel + learning-loop
   counts moving; `unsafeDelivery`/`wrongAccepted` absent.
3. `GET /admin/internal-live/dashboard` — `spendToday` vs caps (gen ≤ 2.00,
   xcheck ≤ 0.50); no auto-raise.
4. `GET /admin/internal-live/review-ops` — clear the review queue (approve /
   reject / regenerate).
5. `GET /admin/pilot/feedback?sinceIso=<24h ago>` — read new verdicts; a
   `CONTENT_QUALITY_ISSUE` / `WRONG_CURRENT_TOPIC` → open a QA look, do **not**
   change mastery.
6. `GET /admin/internal-live/qa` — sample a few; confirm the safe ones look safe.
7. Confirm the safety cron ran (log line every ~10 min) and the maintenance cron
   ran once.
8. Spot-check one real end-to-end: parent Today → worksheet → child practice →
   submit → the Twin/plan moved.

## 10. Test coverage added

- `pilot.integration.test.ts` (pg, 6) — cohort marker, consent record/read/
  withdraw, feedback append-only + hypothesis + no-mastery-change + rollup +
  invalid-verdict reject, LIVE-serving consent gate (blocked → granted → served),
  pseudonymous dashboard, child-deletion purge.
- `pilot.test.ts` (unit, 6) — ref stability, consent constant pin, verdict
  taxonomy, `shouldSampleQa` event triggers + base-rate determinism.
- Full suite: **850 pass / 78 skip / 0 fail** (pre-pilot 844). Migration
  `1758931200000_small_family_pilot` applied to staging, down/up verified.

---

## Deploy — remaining manual actions (STOP-for-hosting, §13)

Claude cannot create external accounts, type a DB password into a provider form,
or purchase hosting. Anh must do the following. **Do not put any secret in source
control** — all of these go into the platform's env / secret store.

### A. Supabase pilot project (separate from staging)

1. Create a new Supabase project (org "Dayhoc", `Echtoan@gmail.com`) — e.g.
   `dayzi-pilot`. Region close to the families (ap-southeast-1 / ap-northeast-2).
2. Set a DB password (the creation form requires it — Claude cannot type it).
3. From it, collect: the **session-pooler** connection URI (port 5432, real
   password) → `DATABASE_URL`; `SUPABASE_URL`; `SUPABASE_JWT_SECRET`;
   `SUPABASE_SERVICE_ROLE_KEY`.
4. Run the migrations against it:
   `DATABASE_URL=<pilot pooler URI> npm run db:migrate`.
5. (Optional) seed non-prod fixtures: `npm run seed:pilot` — **not** for real
   families; real families register through the product.

### B. Application host (HTTPS, always-on)

Any of Fly.io / Render / Railway works (Docker). Requirements: builds the repo
`Dockerfile`, injects env, gives a TLS domain, restarts on crash.

- **Web / API service** — image default `CMD` (`npm run start:web`), port
  `3100`, public HTTPS. Health: `GET /` (or a `/api` route) returns 200.
- **Worker service** — same image, command `npm run worker:worksheet`, **no**
  public port, 1 instance (2 is safe — `FOR UPDATE SKIP LOCKED`), restart-always.
- Both need the full env block below.

### C. Cron / scheduled jobs

- `npm run cron:pilot:safety` — **every 10 minutes** (`*/10 * * * *`). (Fly:
  `[[services]]` cron; Render: Cron Job; Railway: a service with a Cron Schedule.)
  Exits 0 on a normal run **and** when it has to auto-stop LIVE; a stop is logged
  as a `CRITICAL` line — watch the logs / the kill-switch status, not the exit
  code. Exit 1 only on script error (bad config / DB unreachable).
- `npm run cron:pilot:maintenance` — **once daily**, `0 20 * * *` UTC = 03:00
  Asia/Ho_Chi_Minh.
- Every cron service needs the **same full env block** as the web/worker
  services — Railway shared/project variables are not auto-attached, add them per
  service (or paste the block into each service's Variables → Raw Editor).

### D. Environment (platform secret store — NOT `.env` in git)

```
NODE_ENV=production
DATABASE_URL=<pilot Supabase session-pooler URI>
SUPABASE_URL=<...>
SUPABASE_JWT_SECRET=<...>
SUPABASE_SERVICE_ROLE_KEY=<...>
OPENAI_API_KEY=<real key — pilot generation spends real money>
AI_GENERATION_MODE=LIVE
AI_CROSSCHECK_MODE=LIVE
CROSSCHECK_MODEL=gpt-4.1-mini
WORKSHEET_QUEUE=durable
AI_GENERATION_KILL_SWITCH=false
INTERNAL_LIVE_GEN_DAILY_CAP_USD=2.00
INTERNAL_LIVE_XCHECK_DAILY_CAP_USD=0.50
INTERNAL_LIVE_QA_SAMPLE_ONE_IN=5
INTERNAL_LIVE_QA_RETENTION_DAYS=7
PILOT_QA_SAMPLE_RATE=0.08
PILOT_SAFETY_WINDOW_MIN=60
LOG_LEVEL=info
# DZ_DEV_AUTH must NOT be set (production fails closed if it is)
```

### E. After the host is up (still before any real family)

1. Verify the cohort gate end-to-end on the pilot host with a **throwaway**
   internal account: add its family via `POST /admin/pilot/cohort`, confirm no
   LIVE worksheet is served until `POST /children/:id/pilot/consent`, then that
   one is.
2. Confirm the worker claims a job (enqueue via a Today view, watch the worker
   log) and that `worksheet_run_serving` → `SERVED`.
3. Confirm `pilot-cron-safety` logs a clean scan and `pilot-cron-maintenance`
   runs.
4. Only then: add the real invited families (`POST /admin/pilot/cohort`), collect
   guardian consent in the product, and start the 5–7 day window.

---

## §14 — Readiness flags

| flag | state | note |
|---|---|---|
| `PILOT_HOST_READY` | **false** | artifacts built (`Dockerfile`, entrypoints, crons); external host NOT stood up — STOP-for-hosting (§13) |
| `PILOT_WORKER_READY` | **true** | `worksheet-worker.ts` built, boots-or-refuses, SIGTERM-drains; same locked routing/gates as in-process |
| `PILOT_CRONS_READY` | **true** | both cron scripts run clean against staging; schedules documented |
| `PILOT_COHORT_READY` | **true** | `internal_live_cohort` + `kind`/`consent_required`; `addPilotFamily`/`listPilotFamilies`; admin endpoints; migration on staging |
| `PILOT_CONSENT_READY` | **true** | append-only consent (grant + withdrawal-as-new-row); serving gate enforced + tested; onboarding copy is a UI task |
| `PARENT_FEEDBACK_READY` | **true** | append-only `parent_feedback`; 7 verdicts; hypothesis advisory only, never auto-applied (tested); parent + admin endpoints |
| `PILOT_DASHBOARD_READY` | **true** | `pilotDashboard` (activation/engagement/conversion/retention/parent-value/learning-loop), privacy-safe (tested); `GET /admin/pilot/dashboard` |
| `PILOT_SAFETY_READY` | **true** | all six gates unchanged; safety cron flips DB kill switch with no approval/redeploy; QA event-triggered @ 7-day retention |

### `SMALL_FAMILY_PILOT_READY = false`

Everything in software is ready and tested. The one blocker is the **external
host** (§Deploy A–E) — a Supabase pilot project + an always-on HTTPS app host +
a worker process + two crons. That requires anh to create accounts / projects and
enter a DB password, which is a MANDATORY STOP (§13). Once the host is up and
step E passes, flip `SMALL_FAMILY_PILOT_READY = true` and enroll the invited
families.

## Deploy execution notes (anh, Railway — 2026-09)

- **Migrations against the pilot DB:** `.env` gets `PILOT_DATABASE_URL=` (the
  pilot Supabase session-pooler URI); `npm run db:migrate:pilot` (and
  `:status`) runs node-pg-migrate against it via `scripts/pilot-db.mjs` —
  password never in shell history. (PowerShell: `VAR=x cmd` is bash-only.)
- **Operator CLI** `scripts/pilot-admin.mjs` (`npm run pilot:admin …`) — runs
  against `PILOT_DATABASE_URL` directly, no bearer/admin-REST dance:
  `status | grant-admin <email> | add-family <email> [note] | consent
  <parent-email> | list | safety | kill <on|off>`.
- **Railway = 4 services from the one Dockerfile**: `api` (default CMD, port
  3100, healthcheck `/api/v1/health`), `worker` (`npm run worker:worksheet`,
  restart always), `cron-safety` (`npm run cron:pilot:safety`, `*/10 * * * *`),
  `cron-maintenance` (`npm run cron:pilot:maintenance`, `0 20 * * *`). The full
  env block must be on **every** service (Railway shared vars are not
  auto-attached). Region → Singapore for all; keep Supabase in the same region
  (co-location is the dominant latency factor — a distant DB ≈ 1–3 s/nav).
- Crons exit 0 on a clean run **and** on a successful auto-stop (a trip is a
  `CRITICAL` log line, not a non-zero exit — Railway flags non-zero as Crashed).
- `apps/web` `start` honours `$PORT`; `render.yaml` + `docker-compose.pilot.yml`
  + `.dockerignore` committed for the two non-Railway paths.

## Onboarding — parent pins the child's position (2026-09)

Child creation is now **2 steps** so the deterministic engine has real data
instead of a calendar estimate:

1. name + grade (`/onboarding`)
2. `/be/:childId/bat-dau` — **"Con đang học đến bài nào?"** (required, a
   chapter-grouped picker from `getCurriculumProgram`) + optional school / class
   text. `setChildLearningStart` writes the school label to
   `child_profiles.school_context` and records a **PARENT lesson-confirmation
   (STRONG)** → the Curriculum Clock RESOLVES that position (not ESTIMATED), so
   review content matches what the child has actually studied.

Re-confirm any time from **Hồ sơ con → "Bài con đang học"**. Also this session:
guardian card shows a name + Vietnamese relationship label (was raw
`GUARDIAN · SELF_DECLARED`); parent bottom nav is `Hôm nay · Tiến độ · Bài tập ·
Hồ sơ con · Cài đặt` (Kết nối moved inside Cài đặt).

## §13 — MANDATORY STOP boundaries (not crossed)

- ❌ external hosting account / project creation — **STOPPED HERE** (§Deploy).
- ❌ purchasing paid hosting.
- ❌ adding real families to the cohort.
- ❌ public launch / billing / cohort auto-expansion.
- ❌ changing locked model routing or generation architecture.
- ❌ destructive production action.
- ❌ AI model benchmarking (not touched).
