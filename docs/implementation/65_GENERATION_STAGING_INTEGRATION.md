# 65 — GENERATION STAGING INTEGRATION (CHECKPOINT)

> 2026-09-06. FREE phase — **no paid generation, no paid crosscheck, LIVE not
> enabled, routing unchanged, gpt-4o-mini not reintroduced.** Wires the
> production worksheet orchestrator into `services/api` in SHADOW mode, adds
> persistence + cost telemetry + the Group-C crosscheck architecture + a
> review queue + a deterministic content-quality gate. 774 tests / 0 fail.

Locked roles (unchanged): DEFAULT = `gpt-4.1-mini`, HIGH_COMPLEXITY & fallback =
`gpt-5-mini`, never tier-bound.

---

## A. API INTEGRATION

`services/api/src/api.ts`:

- `ApiDeps.worksheetGeneration?` — a new, **independent** hook alongside the C5
  `shadowGeneration`. Fields: `mode` (`AI_GENERATION_MODE`), `queue`
  (`WorksheetShadowQueue`), `generators { default, highComplexity }`,
  `referenceLibrary`, optional `crosscheckAdapter` / `reviewQueue` / `store` /
  `usageSink` / `resolveUsageContext` / `resolveChildRef`.
- `maybeRunWorksheetGeneration(ctx, childId, scene)` — builds a **real**
  `ExerciseGenerationSpec` via `buildExerciseGenerationSpec(...)` (the same
  planner call the C5 hook uses — twin, gaps, resolved context, curriculum) and
  `queue.enqueue(mode, job)`. NEVER awaited, NEVER throws to the handler, result
  NEVER enters the child response. Called right after `maybeRunShadowGeneration`
  in `childToday`.
- Mode gate: `OFF` / `LIVE` → nothing runs (LIVE is reserved; §10). `SHADOW` →
  the full orchestrator runs off the request path.

`@copilot/exercise-gen` new module `worksheet-shadow.ts`:

- `runWorksheetShadow(mode, job)` — OFF/LIVE → `{ ran: false, reason }`;
  SHADOW → runs `orchestrateWorksheet`, records telemetry, persists, builds a
  legacy-vs-new `WorksheetComparison`. Never throws.
- `WorksheetShadowQueue` port + `InMemoryWorksheetShadowQueue` (macrotask
  schedule + `drain()` test helper) + `NoopWorksheetShadowQueue`.

**Flag:** `GENERATION_API_INTEGRATED = true` (SHADOW path wired into `createApi`;
`createProductionApi` wiring is a staging task — §J).

---

## B. PERSISTENCE SCHEMA

Migration `1758499200000_worksheet_generation.js` — **additive, up/down/up
verified** on the portable Postgres.

| table | append-only | holds |
|---|---|---|
| `worksheet_generation_runs` | ⊕ (trigger) | run-level: spec id, `child_ref` (pseudonymous, NOT a FK), mode, worksheet state, slot counts, every component **version**, model-call / retry / fallback / last-resort counts, tokens, est/actual cost, `cost_ceiling_hit`, latency, `cost_event_refs[]` |
| `worksheet_slots` | ⊕ | per-slot: `item_id` (pseudonymous), index, kernel family, initial role, route reason, final state, last-resort used, crosscheck required + verdict, `content_quality_codes[]`, `review_queue_id`, answer status, production-ready, latency |
| `worksheet_slot_attempts` | ⊕ | per-attempt: attempt #, model, role, step (`default`/`retry_same`/`escalate`/`last_resort`), accepted, failure category, retry reason, latency |
| `review_queue` | mutable (one PENDING→resolved) | id, spec id, item id, `child_ref`, reason, state, **short-retention** prompt/solution snapshot for the reviewer, detail, resolved-at/by |

`worksheet-persistence.ts`: `WorksheetGenerationStore` port +
`InMemoryWorksheetGenerationStore` (rejects a duplicate `putRun` — append-only) +
`toWorksheetRecords(spec, result, opts)` (maps → rows, **no prompt/answer/
solution/name text** — asserted by test).

**Flag:** `GENERATION_PERSISTENCE_READY = true` (in-memory + mapping + migration;
the pg-backed store is a thin adapter — §J).

---

## C. COST TELEMETRY

`worksheet-telemetry.ts` `worksheetTraceToUsageEvents(trace, ctx)` →
`AiUsageEvent[]`, **one per model** that participated, using a new
`WorksheetTotals.byModel` breakdown (calls / retries / fallback / tokens /
`actualCostUsd` from `computeActualCost` via the effective-dated
`PricingRegistry` / `priceConfigEffectiveDate`).

- `operationType = 'worksheet_batch_generation'`; `generationSpecId` set;
  `escalatedFrom` / `escalationReason` when a fallback fired; `retryCount` from
  the per-model retry count; `schemaValid` = all calls returned.
- **Plan-independent**: `ctx.plan` is recorded for budget rollups but the events
  are byte-identical regardless of plan (test: `free` vs `pro` → same models,
  same cost).
- `runWorksheetShadow` pushes each event to `job.usageSink` and stores the
  request ids on the run row (`cost_event_refs`).

**Flag:** `GENERATION_COST_TELEMETRY_READY = true`.

---

## D. SHADOW BEHAVIOUR

- OFF / LIVE → `maybeRunWorksheetGeneration` returns immediately; the queue is
  never touched; **zero model calls** (api test).
- SHADOW → the orchestrator runs on a macrotask after the response is built. The
  child-visible `childToday` view is **byte-identical** to the OFF path
  (`expect(view).toEqual(off)`); a generation failure is swallowed.
- `runWorksheetShadow` returns a `WorksheetComparison { legacy, next }` with
  **privacy-safe metrics only** (completed / total / pending-crosscheck / failed
  / model-calls / retries / fallback / last-resort / cost / latency) so a
  staging dashboard can compare the legacy C5 path against the new orchestrator
  without any content.

**Flag:** `SHADOW_MODE_READY = true`.

---

## E. CROSSCHECK ARCHITECTURE

`answer-crosscheck.ts` (extended):

- `AnswerCrosscheckAdapter` port unchanged (PASS / FAIL / UNCERTAIN).
- `runGroupCCrosscheck(exercise, grade, adapter)` → `{ state, verdict, detail }`
  where state = `READY` (PASS) / `REGENERATE` (FAIL) / `REVIEW_QUEUE` (UNCERTAIN).
- Wired into `orchestrateWorksheet`: a Group-C slot that passes content
  validation is crosschecked **before** its attempt is recorded. Generator and
  verifier are logically independent (different adapters, minimum data via
  `toCrosscheckRequest`).
  - PASS → `READY` — but `productionReady` **stays false** (AI-crosschecked ≠
    deterministically verified).
  - FAIL → `accepted = false`, `failureCategory = 'CROSSCHECK_FAIL'` → the normal
    retry chain regenerates it.
  - UNCERTAIN → `PENDING_CROSSCHECK` + a `review_queue` row.
- No adapter → `PENDING_CROSSCHECK`, `crosscheckVerdict = null`. **Never**
  silently marked verified.
- `createMockAnswerCrosscheck(verdictFor)` for tests; `createStubAnswerCrosscheck`
  (always UNCERTAIN, no network) is still the default.

**Flag:** `GROUP_C_CROSSCHECK_ARCH_READY = true`.

### Paid-crosscheck control (§7)

`resolveCrosscheckAdapter(env, buildPaid?)` — a paid adapter is returned **only**
when `AI_CROSSCHECK_MODE === 'LIVE'` **and** `OPENAI_API_KEY` is set **and** a
`buildPaid` factory is supplied. Everything else → the stub. No paid crosscheck
provider adapter is built here; the config gate + flag are ready, disabled.
`AI_CROSSCHECK_MODE` defaults to `OFF`.

---

## F. REVIEW QUEUE

`review-queue.ts` — MVP:

- `ReviewQueueItem` (states `PENDING` / `APPROVED` / `REJECTED` /
  `REGENERATE_REQUESTED`; reasons `CROSSCHECK_UNCERTAIN` /
  `NO_KERNEL_GENERATION_FAILED` / `BOTH_MODELS_FAILED` /
  `CONTENT_QUALITY_NONRECOVERABLE` / `SAFETY_ANOMALY`).
- `ReviewQueueStore` port + `createInMemoryReviewQueue()` — `create` /
  `get` / `listPending` / `resolve(id, state, reviewerRef)`; a second `resolve`
  is rejected.
- `orchestrateWorksheet` raises a row for: every `FAILED` slot
  (`NO_KERNEL_GENERATION_FAILED` if no kernel, else `BOTH_MODELS_FAILED`) and
  every crosscheck-`UNCERTAIN` Group-C slot. Rows carry a pseudonymous
  `child_ref` and a short-retention prompt/solution snapshot — **no name /
  school** (test asserts).
- No reviewer portal (none exists to fit); the port is enough for an admin UI
  to drive.

**Flag:** `REVIEW_QUEUE_READY = true`.

---

## G. CONTENT-QUALITY VALIDATION

`content-quality.ts` `checkContentQuality(exercise, kernel)` (`content-quality.v1`)
— deterministic, no AI. Codes:

| code | severity | catches |
|---|---|---|
| `RAW_LATEX` | BLOCK | `\frac`, `\(…\)`, `$…$`, `\times`, `\sqrt`, `^{`, … — the SGK plain-text UI can't render it |
| `MALFORMED_VIETNAMESE` | BLOCK | prompt with no Vietnamese letters or no ask cue |
| `EMPTY_PROMPT` | BLOCK | prompt < 8 chars |
| `WEAK_HINT_LADDER` | BLOCK | fewer than 6 non-empty hint rungs |
| `WEAK_RUBRIC` | BLOCK | a reasoning item with a < 15-char rubric |
| `OPERATION_LANGUAGE_CONTRADICTION` | BLOCK | a MULTIPLICATION/MIXED kernel whose prompt asks a "per-group" (division) question |
| `UNIT_INCONSISTENT` | WARN | kernel unit missing from the worked-solution answer line |
| `EXCESSIVE_REPETITION` | WARN | a content word ≥ 5× and > 25 % of content words |

Wired into `orchestrateWorksheet` after `acceptItem` passes: a BLOCK finding →
`failureCategory = 'CONTENT_QUALITY'` + a targeted retry instruction (LaTeX-specific
when relevant); WARN → recorded on the slot (`content_quality_codes[]`), item
kept. It **does not** reject for merely imperfect prose (test).

**Flag:** `CONTENT_QUALITY_GATE_READY = true`.

---

## H. PRIVACY REVIEW

| surface | contains PII? |
|---|---|
| `WorksheetTrace` (telemetry) | **No** — versions, states, categories, counts, latency, cost. Test scans the serialized trace for prompt/answer/name → none. |
| `worksheet_generation_runs` / `_slots` / `_slot_attempts` | **No** — pseudonymous `child_ref`, `item_id`; operational metadata only. `toWorksheetRecords` test asserts no prompt/answer/solution/name text. |
| `ai_usage_events` (via `worksheetTraceToUsageEvents`) | **No** — pseudonymous `userRef` / `childRef`, model/token/cost. |
| `review_queue` | pseudonymous `child_ref` + a **short-retention** prompt/solution snapshot for the reviewer (QA data, purged on schedule — not operational telemetry). No name / school / evidence / gap. |
| `WorksheetResult.rawSlots` | prompt + solution text — **only** when `config.captureRaw` is set (explicitly-gated QA path, OFF by default). Not persisted by the SHADOW wrapper. |

The API `childToday` response is unchanged and still passes `assertChildSafe`.

---

## I. REGRESSION STATUS

| check | result |
|---|---|
| full unit suite | **774 pass / 45 skip / 0 fail** |
| new: `content-quality.test.ts` (9), `worksheet-staging.test.ts` (13), api `doc 65` block (3) | green |
| existing `worksheet-orchestrator.test.ts` (13), `api.test.ts` (23), golden / e2e / child-projection | green |
| `tsc -b` (all packages + services) | clean |
| typecheck web / mobile | clean / clean |
| lint | no new errors (10 pre-existing in `luna-generator` / `production-api` / `item-pipeline.test`) |
| migration `1758499200000` up / down / up | verified on pg-portable |

---

## J. REMAINING STAGING-ENV REQUIREMENTS

1. **`createProductionApi` wiring** — the SHADOW hook is on `createApi` (the
   established shadow-integration surface). `createProductionApi` (DB-backed,
   server-derived identity) needs the same `worksheetGeneration` dep + call site,
   plus a real `WorksheetShadowQueue` backed by the job queue and a pg
   `WorksheetGenerationStore` / `ReviewQueueStore` adapter (thin — the migration
   + mapping already exist).
2. **`resolveChildRef` / `resolveUsageContext`** must be supplied by
   `createProductionApi` from the pseudonymisation service already used for
   `ai_usage_events` (do not pass raw child ids).
3. **Config**: `AI_GENERATION_MODE=SHADOW` + `AI_CROSSCHECK_MODE=OFF` in the
   staging env; `OPENAI_API_KEY` for the two generators (gpt-4.1-mini,
   gpt-5-mini); pricing registry seeded (already dated 2026-01-15).
4. **Retention job**: add `review_queue.prompt_snapshot` /
   `worked_solution_snapshot` to the existing raw-upload purge schedule
   (short-retention QA data).
5. **Dashboard**: a read-only view over `worksheet_generation_runs` +
   `WorksheetComparison` for the legacy-vs-new SHADOW comparison (§D).
6. **Deletion interaction**: the child-deletion workflow must cascade
   `worksheet_generation_runs` (FK to `generation_specs` → `child_profiles` is
   `ON DELETE CASCADE`) and null / purge `review_queue` rows for that child_ref —
   add to `deletion_jobs` step order.

---

## K. PROPOSED SMALL PAID CROSSCHECK TEST (not run)

| parameter | value |
|---|---|
| purpose | validate a real `AnswerCrosscheckAdapter` (PASS/FAIL/UNCERTAIN) on ~15–20 Group-C reasoning items drawn from the doc 64 raw sidecar + a few fresh |
| provider | one model (gpt-4.1-mini or gpt-5-mini), `advanced_verification` operation |
| gating | `AI_CROSSCHECK_MODE=LIVE` + explicit approval only |
| **hard cap** | **≤ USD 0.20** |
| report | verdict distribution, agreement with a human spot-check on 5, cost / item, false-PASS rate (must be 0) |

Awaiting approval. Not a blocker for staging SHADOW (Group-C items ship
`PENDING_CROSSCHECK` until then).

---

## L. PROPOSED STAGING SHADOW TEST (not run — needs the staging env)

| parameter | value |
|---|---|
| trigger | real `childToday` requests on the staging cohort (pilot-shaped synthetic children) |
| mode | `AI_GENERATION_MODE=SHADOW`, `AI_CROSSCHECK_MODE=OFF` |
| duration | ~1 week or ~200 worksheet runs |
| collect | `WorksheetComparison` (legacy C5 vs new orchestrator): full-worksheet completion, deterministic vs PENDING_CROSSCHECK split, retry / fallback / last-resort rates, cost / worksheet, p50/p95 latency, review-queue volume by reason |
| **spend** | real generator calls — needs a staging budget line; per-worksheet `costCeilingUsd` set (~$0.02–0.05) + a daily cap |
| exit criteria to consider LIVE | full-worksheet ≥ 99 %, kernel deterministic correctness = 100 %, 0 validator FP, review-queue volume manageable, cost within the plan budget envelopes |

---

## FLAGS

```
GENERATION_API_INTEGRATED        = true   (createApi SHADOW; createProductionApi pending — §J.1)
GENERATION_PERSISTENCE_READY     = true   (in-memory + mapping + migration; pg adapter pending — §J.1)
GENERATION_COST_TELEMETRY_READY  = true
GROUP_C_CROSSCHECK_ARCH_READY    = true   (architecture + config gate; paid adapter disabled — §K)
REVIEW_QUEUE_READY               = true   (MVP: port + in-memory + orchestrator wiring; no portal)
CONTENT_QUALITY_GATE_READY       = true
SHADOW_MODE_READY                = true
LIVE_MODE_ENABLED                = false
```

## STOP

Not done: paid generation · paid crosscheck · LIVE · routing change · benchmark ·
gpt-4o-mini · `createProductionApi` wiring. Returned A–L + flags. Awaiting
approval for §J (staging wiring), §K (paid crosscheck test), §L (staging SHADOW).
