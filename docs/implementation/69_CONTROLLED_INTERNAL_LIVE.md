# 69 — CONTROLLED INTERNAL LIVE ROLLOUT

> Anh's directive, 2026-09-08. Baseline `main @ 65113ca` (D7B FINAL passed,
> `INTERNAL_LIVE_READY=true`). The generation architecture is **LOCKED**. This
> phase builds the control plane in front of it and STOPS before the LIVE flip.

**Nothing here exposes a public user, changes model routing, or enables billing.**

## 1. Internal-live cohort gate

LIVE generation requires **BOTH**:

- `AI_GENERATION_MODE=LIVE`, **AND**
- the acting family's pseudonymous ref (`sha256(familyId).slice(0,16)`) is in
  `internal_live_cohort` (and not soft-removed).

Everything else stays **SHADOW** (LIVE configured, family not eligible) or **OFF**.
`resolveEffectiveGenerationMode(pool, env, familyRef)` (`internal-live.ts`) is the
single decision point; a `null` familyRef can never be LIVE. Staging-wide LIVE is
impossible — there is no path that sets LIVE for a family not on the allowlist.

Admin: `internalLiveCohort{List,Add,Remove}` · `GET/POST/DELETE /admin/internal-live/cohort`.

## 2. Kill switch

`resolveKillSwitch(pool, env)` — active if **either**:

- `AI_GENERATION_KILL_SWITCH=true` (env — deploy-time), **or**
- `ai_generation_runtime.kill_switch=true` (DB — **no redeploy**, toggled by
  `POST /admin/internal-live/kill-switch` or the safety monitor).

When active: `resolveEffectiveGenerationMode` degrades every LIVE family to
SHADOW → **no new paid generation call from the LIVE serving path, no new paid
crosscheck call**. Existing assignments, practice, evidence, Twin, plans all keep
working (the legacy reference-library path is untouched). Verified in
`internal-live.integration.test.ts §1/§2`.

## 3. Internal-live operational budgets

`INTERNAL_LIVE_GEN_DAILY_CAP_USD` (default **2.00**) ·
`INTERNAL_LIVE_XCHECK_DAILY_CAP_USD` (default **0.50**). Not benchmark budgets;
not auto-raised. `internal_live_spend` is a per-UTC-day ledger; the LIVE
generation callback records actual spend per operation. `internalLiveBudgetGate`
is checked before enqueuing a LIVE worksheet — **exhaustion degrades to SHADOW**
(the child still gets a legacy worksheet), it never errors the product flow.

## 4. Safety auto-stop

`scanInternalLiveSafety(pool)` over the last 24h of LIVE runs. **CRITICAL** (→
auto kill switch + `internal_live_safety_events` row):

- delivered item with a **deterministically-proven-wrong** answer
- **unverified** item delivered (neither deterministic-correct nor crosscheck-PASS)
- crosscheck **PASS contradicted by the kernel**
- **SEMANTIC_UNKNOWN** item delivered

**WARNING** (alert only): kernel correctness < 100%, review-queue spike, cost
spike, latency spike. `enforceSafetyAutoStop` is idempotent. Wire it to a cron
(`POST /admin/internal-live/safety-scan`) — e.g. every 10 min once LIVE.

## 5. LIVE serving path (cohort children only)

`getToday` / `getChildAssignments` for a LIVE-eligible family:

1. **serve** any completed LIVE worksheet held in `worksheet_run_serving` (PENDING)
   → an `AI_GENERATED` assignment. **Only verified READY items** reach the child
   (`servableItemsOf` filters again — defence in depth). Held content is nulled on
   serve; one-time transition; idempotent.
2. else **enqueue** one LIVE worksheet for today (`egs_<childRef>-<date>` →
   durable-queue dedup = one/child/day), budget-gated.

The run persists pseudonymously (`worksheet_generation_runs.mode='LIVE'`, no
childId). `worksheet_run_serving` holds the items keyed by `child_ref` **only**
until the next authenticated request from that child; TTL 48h; purged on child
deletion.

## 6. End-to-end learning loop

Already wired and tested (`practice-loop.integration.test.ts`) — an AI worksheet
is just an assignment: `submitPractice` → per-answer append-only `evidence` →
`invalidateDerived` → next `getParentProgress`/`getToday` recomputes the Twin,
gaps and plan. `internal-live.integration.test.ts §5/§6` proves it end-to-end for
an `AI_GENERATED` assignment (evidence appended, `skill_states` created for the
practised skill).

## 7. Internal-live observability

`internalLiveDashboard(pool)` (`GET /admin/internal-live/dashboard`) — privacy-safe
(no question/answer/evidence content):

- CORE_WORKSHEET_DELIVERY / VERIFIED_DELIVERY / UNSAFE_DELIVERY
- first-pass / retry / fallback / last-resort / safe-substitution / omission /
  crosscheck / review-queue rates
- cost/worksheet · p50/p95 latency
- budgets (caps, spent today, remaining) · kill-switch state · cohort size
- product funnel: AI worksheet runs · assignments created / completed ·
  worksheet→practice conversion · day-1 return (children active on two
  consecutive days) · active children
- `failureBreakdown`

## 8. Wave-1 QA sampling

`internal_live_qa_sample` — 1-in-`INTERNAL_LIVE_QA_SAMPLE_ONE_IN` (default 5)
delivered LIVE worksheets, up to 3 items each. **SHORT retention**
(`INTERNAL_LIVE_QA_RETENTION_DAYS`, default 7, capped 30). Reads are
**access-logged** (`access_log` jsonb — who/when). **Excluded from analytics** —
it is operational review data. `purgeExpiredQaSamples` nulls the content past
retention, keeps the operational row. `POST /admin/internal-live/maintenance`
runs the QA + serving-intent sweeps. Purged on child deletion.

## 9. Optional quality (do not block LIVE)

D7B FINAL `OPTIONAL_OMISSION_RATE ≈ 25%` (all optional slots, all → review, none
block delivery). Tracked on the dashboard + `failureBreakdown`. Not a LIVE
blocker; no automatic prompt/model research.

## 10. Review-queue operations

`reviewQueueOps(pool)` (`GET /admin/internal-live/review-ops`): pending / resolved
counts, pending-by-reason, resolved-by-decision, oldest + median pending age,
median PENDING→resolved time. Reviewers act via the existing
`reviewQueueListPending` / `reviewQueueResolve` (doc 67 §D4) — reasons covered:
`CROSSCHECK_UNCERTAIN`, `NO_KERNEL_GENERATION_FAILED`, `BOTH_MODELS_FAILED`,
`CONTENT_QUALITY_NONRECOVERABLE`, `SAFETY_ANOMALY`.

## Migration

`1758844800000_internal_live_controls` — on staging, down/up verified. Tables:
`internal_live_cohort`, `ai_generation_runtime` (singleton), `internal_live_spend`,
`internal_live_safety_events`, `worksheet_run_serving`, `internal_live_qa_sample`.

## THE FLIP (anh only — doc 69 §12, still NOT done)

All 8 readiness flags are green. To start Wave 1:

1. **Deploy env** (secret manager — never in source):
   ```
   AI_GENERATION_MODE=LIVE
   AI_CROSSCHECK_MODE=LIVE
   WORKSHEET_QUEUE=durable
   AI_GENERATION_KILL_SWITCH=false
   INTERNAL_LIVE_GEN_DAILY_CAP_USD=2.00
   INTERNAL_LIVE_XCHECK_DAILY_CAP_USD=0.50
   INTERNAL_LIVE_QA_SAMPLE_ONE_IN=5
   INTERNAL_LIVE_QA_RETENTION_DAYS=7
   OPENAI_API_KEY=<key>            # already set on staging
   ```
   Locked model routing unchanged: `WORKSHEET_DEFAULT_MODEL=gpt-4.1-mini`,
   `WORKSHEET_HIGH_COMPLEXITY_MODEL=gpt-5-mini`, `CROSSCHECK_MODEL=gpt-4.1-mini`,
   `CROSSCHECK_GEOMETRY_MODEL=gpt-5-mini`. Do **not** add `gpt-4o-mini`.

2. **Run a `WorksheetJobWorker`** process (`createWorksheetJobWorker({ pool, knowledgeBase }).start()`).

3. **Add the 3–5 internal families** (ADMIN token):
   `POST /admin/internal-live/cohort  { "familyId": "<uuid>", "wave": 1, "note": "internal QA" }`

4. **Schedule the safety cron** — every ~10 min:
   `POST /admin/internal-live/safety-scan`  (activates the kill switch on any CRITICAL condition)
   and daily: `POST /admin/internal-live/maintenance` (QA + serving-intent retention sweeps).

5. **Watch** `GET /admin/internal-live/dashboard` + `/review-ops`.

**Immediate stop:** `POST /admin/internal-live/kill-switch { "on": true, "reason": "..." }`
(or `AI_GENERATION_KILL_SWITCH=true` at the platform) — halts every new paid AI
call with no redeploy; the app keeps serving the legacy path.
