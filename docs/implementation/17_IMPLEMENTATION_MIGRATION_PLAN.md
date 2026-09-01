# 17 — Implementation Migration Plan (AI-Generation-First)

> Phase 3 of the migration. Atomic steps, ordered so the running app/demo never
> breaks.
> **✅ APPROVED by anh 2026-09-01** with the 5 open-question answers locked:
> O-2 split `@copilot/practice` + `@copilot/exercise-gen` · O-3 22 draft questions
> are enough grounding to start · O-4 Worksheet Mode first, Adaptive later ·
> O-5 incremental on `main` + feature flags · O-1 seed the academic calendar from
> public MOET/SGK sources.
> Context: [12](12_ARCHITECTURE_MIGRATION_AUDIT.md) · [13](13_CURRICULUM_CLOCK_AND_CONTEXT_RESOLVER.md) · [14](14_AI_EXERCISE_GENERATION_ARCHITECTURE.md) · [15](15_AI_COST_AND_MODEL_ROUTING.md) · [16](16_ARCHITECTURE_MIGRATION_CHANGELOG.md).

**Invariants for every step:** typecheck + lint + full test suite green; Golden
expected outputs never edited; each new path lands *behind* the old one, proven,
then the default flips and the old path is deleted in a later step.

---

## Group A — Cost/Routing v1.1 (independent, low risk) — ✅ DONE (2026-09-01)

> Landed: `margin.ts` (v1.1 numbers + `absoluteBoundaryVnd`), `budget.ts`
> (`AIBudgetGuardrail` 4-state + `checkBudget` on operational ceiling), `routing.ts`
> (v1.1 operation taxonomy, `AIModelRouter`, no `question_bank` tier, plan≠model),
> `usage-event.ts` (`AICostLedger` fields + `forecastByOperation`). Migration
> `1756857600000_ai_cost_v1_1` (verified up/down/up). Test files rewritten to v1.1.
> `PRICING_AND_COST_GUARDRAILS.md` stubbed → `15`; CLAUDE.md updated. 270 tests green.
> **`@copilot/ai` code still callable by the current (v1.0-shaped) pipeline** — the
> operation names changed but no v1.0 *runtime* path consumed them yet.


### A1 — `PLAN_COMMERCIALS` → v1.1 numbers
- **Goal:** `margin.ts` reflects v1.1 targets/ceilings/absolute boundaries.
- **Files:** `packages/ai/src/margin.ts`, `margin.test.ts`.
- **Deps:** none.
- **DB:** none.
- **API:** none.
- **Tests:** rewrite `margin.test.ts` to `pricing_guardrails_v1.1.yaml` (BASIC 88,750 @ target, 51.3% @ ceiling; PLUS 126,750 / 52.3%; PRO 188,750 / 53.7%). Add `absoluteBoundaryVnd` + a test that ceiling < absolute < 50%-line.
- **Golden:** none.
- **Rollback:** revert file.
- **Acceptance:** numbers match the yaml to the last digit; `minimumPriceForFloor` still holds for all paid plans.

### A2 — `AIBudgetGuardrail` (4 states, 3 thresholds)
- **Goal:** replace `marginLight` 3-state with GREEN/YELLOW/RED/BLOCKER.
- **Files:** `packages/ai/src/budget.ts` (+ new `guardrail.ts`), `budget.test.ts`, new `budget-guardrail.test.ts`.
- **Deps:** A1.
- **DB:** none yet.
- **API:** none.
- **Tests:** TEST 12 (projected > operational ceiling → RED, standard tasks forced to default route, advanced-necessary escalation preserved). TEST 13 (projected crosses absolute boundary → BLOCKER, requires approval flag). Retry-loop simulation still cannot cross the ceiling.
- **Golden:** none.
- **Rollback:** keep `marginLight` export as a deprecated alias for one step.
- **Acceptance:** all 13 → correct state; RED never reduces educational quality in the code path (only routing/abuse controls).

### A3 — `AIModelRouter` + v1.1 operation taxonomy
- **Goal:** `routing.ts` → `AIModelRouter`; `AI_OPERATIONS` → v1.1 taxonomy; assert plan is not a routing input.
- **Files:** `packages/ai/src/routing.ts`, `routing.test.ts`, new `model-router.test.ts`.
- **Deps:** none (parallel with A1/A2).
- **DB:** none.
- **API:** none.
- **Tests:** TEST 10 (PRO + K2/T2 → default model). TEST 11 (BASIC + legit T5/HSG → advanced gate fires). Advanced-candidate gate: K4/K5, T4/T5, HSG, proof, nonlinear, verifier-fail, low-confidence. `advancedModelPending` still → Luna high-effort + `escalated_from`.
- **Golden:** none.
- **Rollback:** revert; `resolveRoute` kept as a thin wrapper.
- **Acceptance:** no code path lets `plan` change the chosen model.

### A4 — `AICostLedger` fields + operation forecast
- **Goal:** `AiUsageEvent` gains `model_version`, `price_config_effective_date`, `generation_spec_id`, `learning_context_source`, `K_target`, `T_target`, `escalated_from`; `rollup()` forecasts by operation.
- **Files:** `packages/ai/src/usage-event.ts` (+ rename to `cost-ledger.ts`), `usage-event.test.ts`.
- **Deps:** A3 (operation taxonomy).
- **DB:** migration `..._ai_cost_v1_1.js` — add columns to `ai_usage_events` (all nullable), new `ai_operation_cost_rollup`. Verify up/down/up + append-only trigger still fires.
- **API:** none.
- **Tests:** builder fills new fields; `forecastByOperation(events)` = Σ(volume × unit × retry factor); PII guard (no child name).
- **Rollback:** columns nullable + additive → safe to leave; revert code.
- **Acceptance:** every telemetry field from v1.1 §10 present.

### A5 — doc + config: replace `PRICING_AND_COST_GUARDRAILS.md`, update `CLAUDE.md`
- **Goal:** `15` is authoritative; old doc a stub; `CLAUDE.md` AI-cost invariants → v1.1.
- **Files:** docs only.
- **Acceptance:** no doc still cites the v1.0 numbers as current.

---

## Group B — Curriculum Clock & Context Resolver

> **B1 + B2 + B3 ✅ DONE (2026-09-01).** New `@copilot/curriculum-clock`
> (`CurriculumClockService`), provisional calendars for G4+G7 KNTT 2026–2027
> (`packages/math-data/data/calendars/`, built into `calendars.json`).
> `@copilot/learning-context` gains `resolveLearningContext` (reliability-weighted
> scoring **plus** deterministic guardrails A–F, not latest-wins). `LearningContext`
> type extended with `expected` / `resolved` / `paceDelta` / `paceDeltaHypothesis`;
> `standardPosition` / `actualTaughtPosition` kept as deprecated aliases.
> `buildLearningContext` calls clock + resolver. **B3 wired the clock into the
> runtime** — API `GET /children/:id/learning-context` + `POST .../confirm-lesson`
> (append-only, routed through the resolver), projection `contextStatus`, web
> `LearningContextCard` (Expected vs Confirmed/Resolved), 3-child functional demo
> (`packages/testing/src/demo/b3-context-demo.ts` → `docs/implementation/B3_DEMO_OUTPUT.md`).
> 305 tests green.
>
> **Clock now emits `expectedWindow` (range, never a single "actual" lesson).**
> ESTIMATED is never presented as fact in any surface. Calendars carry provenance
> metadata (`calendar_id`, `curriculum_id`, `grade`, `academic_year`, `version`,
> `status: PROVISIONAL|VERIFIED`, `effective_from/to`, `source`) — a new school
> year is a new calendar file, no business-logic edit.


### B1 — calendar reference data + `@copilot/curriculum-clock`
- **Goal:** `CurriculumClockService.positionFor(child, date)` → estimated position.
- **Files:** new `packages/math-data/data/calendars/{g4,g7}-2026-2027.yaml` (from SGK phân phối chương trình); `packages/math-data/scripts/build-kb.mjs` (load calendars); new `packages/curriculum-clock/`.
- **Deps:** none.
- **DB:** none (calendar is built into the KB like the skill graph).
- **API:** none.
- **Tests:** `curriculum-clock.test.ts` — week→lesson mapping, holiday subtraction, `pace_delta` application, window (primary + also-plausible), idempotent.
- **Golden:** none (new).
- **Rollback:** package unused by default until B3.
- **Acceptance:** TEST 1 precondition — a Grade-4 child with only enrollment + date gets a plausible lesson at `ESTIMATED` confidence.
- **Open question O-1 (anh):** which academic-year calendar to seed for the pilot (2026–2027 official dates + Tết/hè). Can be derived from public MOET/SGK sources — flagged, not blocking.

### B2 — `LearningContext` type extension + `LearningContextResolver`
- **Goal:** `LearningContext` gains `expected` / `resolved` / `paceDelta`; `LearningContextResolver.resolve(...)` implements the reliability-weighted merge.
- **Files:** `packages/domain/src/context.ts`, `packages/learning-context/src/{resolver.ts,build.ts}`, `build.test.ts`, new `context-resolver.test.ts`.
- **Deps:** B1.
- **DB:** migration `..._curriculum_calendar_and_context.js` — `curriculum_calendars` (if any runtime override needed), `child_school_enrollment`, `learning_context_snapshots` (⊕), `teacher_contributions.reliability`.
- **API:** none yet.
- **Tests:** TEST 2 (verified parent update overrides estimate), TEST 3 (repeated evidence → `pace_delta`, history preserved), estimate-doesn't-overwrite-recent-verified, idempotent replay.
- **Golden:** existing `build.test.ts` must still pass (keep `standardPosition`/`actualTaughtPosition` aliases). E2E Family Journey unaffected (context shape is a superset).
- **Rollback:** `buildLearningContext` keeps its old body behind a flag; resolver additive.
- **Acceptance:** all downstream consumers (`planning`, `projections`, `revision`, `api`, `web`) compile against the extended type unchanged; new fields populated.

### B3 — wire clock+resolver into `buildLearningContext` + API + web — ✅ DONE (2026-09-01)
- **Goal:** the app resolves context with zero parent/teacher input.
- **Files:** `packages/domain/src/context.ts` (`ExpectedLessonWindow`, `CalendarProvenance`, `ExpectedLearningContext`, `ResolvedLearningContext`, `LessonConfirmationEvent`), `packages/curriculum-clock/src/clock.ts` (`expectedWindow`, `CalendarProvenance`), `packages/math-data/{data/calendars/*.yaml,src/calendars.ts}` (provenance metadata), `packages/learning-context/src/{resolver.ts,build.ts}` (guardrails A–F, grade filter, pace hypothesis), `packages/evidence/src/{store,service,pg-store}.ts` (`recordLessonConfirmation`, append-only), `services/api/src/api.ts` (`learningContext`, `confirmLesson`), `packages/projections/src/parent.ts` (`contextStatus`), `packages/api-contract/src/view-models.ts`, `apps/web/app/components.tsx` (`LearningContextCard`), `apps/web/lib/demo-scene.ts`, `packages/testing/src/demo/b3-context-demo.ts` + `scripts/b3-demo-report.mjs`.
- **Deps:** B1, B2.
- **DB:** migration `1756944000000_curriculum_context.js` — `child_school_enrollment`, `lesson_confirmations` (⊕ append-only trigger), `learning_context_snapshots` (⊕), `curriculum_calendars`. Verified up/down/up.
- **API:** `GET /children/:id/learning-context` (returns `expected`, `resolved`, `paceDelta`, `paceDeltaHypothesis`, `conflicts`, `calendar`; rejects child role) · `POST /children/:id/confirm-lesson` (`{lessonId, topicNote?, confidence?}` → appends a `LessonConfirmationEvent` via `EvidenceService`, re-scenes, returns `{event, resolved, expected}`; parent/teacher/admin only).
- **Guardrails (deterministic, not just the score):** A recent VERIFIED never overridden by CURRICULUM_TIMELINE or a low-confidence majority · B repetition raises score, never the confidence tier · C ≥3 consistent SUPPORTING → one-tier promote + `paceDeltaHypothesis` · D conflicting VERIFIED on different lessons → conflict state, most-recent-VERIFIED wins (no silent numeric pick) · E stale VERIFIED (>35d) downgraded for scoring, kept in history · F human confirmation vs observed schoolwork are distinct source types.
- **expectedWindow:** `{fromLessonId, toLessonId, widthLessons, lessonIds}` — width = `pace_uncertainty_lessons` (+1 if school week ≤3, +1 if a holiday just ended). Never collapsed to a single "actual" lesson.
- **Tests:** `clock.test.ts` (12), `resolver.test.ts` (13, incl. B3-1..B3-6 + invariants A–F), `build.test.ts` (5), `api.test.ts` B3 block (B3-1/2/3/7/9/10 + confirm-lesson role gates), `b3-context-demo.test.ts` (4). 305 pass / 2 skip overall.
- **Golden:** E2E Family Journey checkpoints unchanged (context shape is a superset).
- **Feature flag:** `enrollment` on the child profile / demo scene is what activates the clock path — absent ⇒ `expected` is `null` and the resolver falls back to observed evidence (old behaviour). No child in production has enrollment yet, so the runtime path is dark until a calendar is marked `VERIFIED` and enrollment is populated.
- **Acceptance:** demo home shows "CON ĐANG HỌC · Tính chất dãy tỉ số bằng nhau · ● Giáo viên đã xác nhận · Lịch chương trình dự kiến: Đại lượng tỉ lệ thuận" — Expected vs Confirmed both visible, ESTIMATED never shown as fact.

---

## Group C — Exercise Generation

### C1 — `ExerciseGenerationSpec` type + schema + `buildExerciseGenerationSpec` — ✅ DONE (2026-09-01)
- **Goal:** deterministic spec from context + graphs + twin + gaps + readiness + thinking + frontier + goal + time.
- **Files:** `packages/domain/src/exercise-gen.ts`, `packages/schemas/src/exercise-generation.schema.ts`, `packages/planning/src/{exercise-spec.ts,exercise-spec.test.ts}`, `packages/testing/src/golden/exercise-spec.test.ts` (+`context`/`parentGoal` on `TwinPlannerRun`).
- **Deps:** B2 (resolved context).
- **DB / API:** none.
- **Tests:** CASE A (weak-prereq vs strong+HSG at the same lesson → materially different specs), CASE B (above-grade frontier + prereq weakness → `prerequisiteRepair ≥ 1` **and** `advanced ≥ 1`, no global downgrade), CASE C (parent goal changes allocation/K/T, never mastery), CASE D (ESTIMATED context → more conservative than VERIFIED), pure function, distribution reconciles. Golden: 48 profiles → 48 schema-valid specs, no expected-output edits.
- **Rollback:** additive; nothing consumes the spec yet (C4 is not started).
- **Acceptance:** `distribution` sums to `totalQuestions`; K/T ranges ordered & tied to twin+frontier; constraints set; every target id resolves in the KB.
- **Determinism:** `buildExerciseGenerationSpec` is a pure fn of (context, KB, twin, gaps, readiness, frontier, goal, time). `plannerVersion` = `exercise-spec.v1`.

### C2 — `@copilot/reference-library` (repurpose the bank) — ✅ DONE (2026-09-01)
- **Goal:** `questions*.json` → grounding / examples / calibration / validation, **not delivery**.
- **Files:** new `packages/reference-library/` (`library.ts` + `data/questions*.json` moved from `@copilot/practice`); `packages/practice/src/question-bank.ts` **deleted**; `assignment.ts` now reads `@copilot/reference-library` (marked LEGACY delivery, C5 replaces it); `practice/src/index.ts` drops the bank export; importers updated in `apps/web/lib/child-scene.ts`, `packages/testing/{pipeline,projections}.test.ts`; root/testing/web tsconfig + package.json + `next.config.transpilePackages`.
- **Deps:** none (parallel with C1).
- **DB / API:** none.
- **API surface:** `loadReferenceLibrary()`, `examplesForSkill(skillId)`, `groundingExamplesFor({skillId, problemTypeId?, K?, T?, limit=3})`, `calibrationRangeFor(skillId)`. **No "pick a question to serve a child" function exists.**
- **Tests:** `reference-library/src/library.test.ts` — corpus schema + 6-rung ladder + AI-draft flags (moved from `practice.test.ts`); grounding returns ≤ limit, prefers same problem type, unknown skill → `[]`, deterministic.
- **Golden:** `golden/mapping.test.ts` unchanged (still the skill-id gate).
- **Acceptance:** `@copilot/practice` no longer exports `loadQuestionBank`; the corpus is grounding/calibration only. Legacy `buildAssignment` still works via the library shim until C5.

### C3 — `GeneratedExerciseValidator` (`@copilot/exercise-gen`)
- **Goal:** deterministic gate: schema, known IDs, K/T range, prereq safety, answerability, uniqueness, hint ladder, safety.
- **Files:** new `packages/exercise-gen/`, `generated-validator.test.ts`.
- **Deps:** C1 (spec), C2 (KB access).
- **DB:** none.
- **API:** none.
- **Tests:** TEST 8 (unknown `skill_id` → item rejected, batch still delivers valid ones), range/prereq/uniqueness/hint-ladder rejection cases, `reasoning` rubric required.
- **Golden:** feed the 120 golden questions through the validator → all pass (they are valid by construction) — regression fixture.
- **Rollback:** additive.
- **Acceptance:** no invalid item can reach an `Assignment`.

### C4 — `ExerciseGenerator` + `AiOrchestrator.runBatchGeneration` (mock first)
- **Goal:** `spec → 1 batch call → N items`; `MockExerciseGenerator` for CI/demo.
- **Files:** `packages/ai/src/{exercise-generator.ts, orchestrator.ts}`, `packages/ai/src/providers/mock.ts` (mock generator), tests.
- **Deps:** C1, C3, A3 (router), A4 (ledger).
- **DB:** migration `..._generated_exercises.js` — `generation_specs` (⊕), `generated_exercise_sets`.
- **API:** none yet.
- **Tests:** TEST 6 (10-q worksheet → generator called once → 10 items → validator → assignment); cost ledger row with `operation_type: WORKSHEET_BATCH_GENERATION`, `generation_spec_id`.
- **Golden:** none (mock output is deterministic).
- **Rollback:** generator behind flag; mock only in CI.
- **Acceptance:** batch path produces a validated `Assignment{questions[]}` from a spec.

### C5 — flip the practice path: plan → spec → generate → validate → assignment
- **Goal:** `buildDailyPlan` also emits spec(s); `generateWorksheet(plan)` replaces `buildAssignmentsForPlan`.
- **Files:** `packages/planning/src/daily-plan.ts`, `packages/practice/src/assignment.ts` (**delete** the bank path), `packages/testing/src/pipeline.test.ts` (rework), `apps/web` demo scenes.
- **Deps:** C1–C4, B3.
- **DB:** none new.
- **API:** assignment/daily-plan response carries `questions[]` + `generationSpecId`.
- **Tests:** `pipeline.test.ts` end-to-end via mock generator; `practice.test.ts` reworked; hint-ladder / submission / offline-queue unchanged.
- **Golden:** Twin/Planner + E2E — add `generationSpecId` assertions; **expected outputs unchanged**.
- **Rollback:** flag `USE_GENERATION` (old bank path kept one release, then deleted in C6).
- **Acceptance:** demo child screen shows an AI-generated (mock) worksheet; no `loadQuestionBank` in the delivery path.

### C6 — Interactive Adaptive Mode (`nextBestMove` + `NEXT_BEST_QUESTION`)
- **Goal:** event-driven next question after an attempt.
- **Files:** `packages/exercise-gen/src/next-best.ts`, `packages/ai` (single-item generate), `services/api` (attempt → maybe next question), tests.
- **Deps:** C5.
- **DB:** none new.
- **API:** `POST …/attempts` response may include `nextQuestion`.
- **Tests:** TEST 7 (Q1–Q3 fast-correct, Q4 wrong + Hint2 success → move ∈ {DIAGNOSTIC, GAP_REPAIR}); careless → KEEP + self-check.
- **Golden:** Error dataset informs the diagnostic pivot; no expected edit.
- **Rollback:** flag; worksheet mode works without it.
- **Acceptance:** adaptive session changes difficulty/mode per the deterministic policy, one AI call per new item.

### C7 — delete obsolete code
- **Goal:** remove `buildAssignment`/`buildAssignmentsForPlan` bank path, demote `stretch-zone`, drop `@copilot/practice` re-exports of the bank.
- **Deps:** C5, C6 green for one release.
- **Acceptance:** grep for `loadQuestionBank` returns only `@copilot/reference-library` + golden tests.

---

## Group D — FREE plan + budget wiring + benchmark

### D1 — FREE fallback (cached/transform, never fake diagnosis)
- **Files:** `packages/exercise-gen/src/fallback.ts`, `budget` integration.
- **Tests:** budget pressure → reuse prior personalized set / deterministic number-swap; UI never labels a cached set "phân tích mới".
- **Acceptance:** matches `ai_budget_guardrails_v1.1.yaml` `free_policy`.

### D2 — guardrail ↔ router ↔ generator wiring + `ai_operation_cost_rollup`
- **Files:** `services/api`, `packages/ai`.
- **DB:** rollup table populated from `ai_usage_events`.
- **Tests:** projected COGS crossing operational ceiling → RED forces standard ops to default; BLOCKER stops rollout.
- **Acceptance:** `forecastByOperation` matches `Σ(volume × unit × retry factor)`.

### D3 — benchmark decision template update
- **Files:** `packages/testing/benchmark-data/reports/FINAL_ROUTING_DECISION_TEMPLATE.json`, `src/benchmark/*`.
- **Note:** still needs real anonymized images (D-07, deferred to post-pilot). Adds "projected AI COGS by plan under AI-generation-first usage" as a required output.

---

## Ordering summary

```
A1 → A2 ┐
A3 ─────┼→ A4 → A5           (cost/routing v1.1 — safe, first)
        │
B1 → B2 → B3                 (clock + resolver)
        │
C1 ─────┤
C2 ─────┼→ C3 → C4 → C5 → C6 → C7   (generation — the big one)
        │
        └→ D1, D2, D3        (FREE + wiring + benchmark)
```

Groups A and B can run in parallel. C depends on B2 (resolved context) and A3/A4
(router/ledger). D closes the loop.

---

## Risks

| Risk | Mitigation |
|---|---|
| Generation quality (wrong K/T, unsolvable, bad hints) | multi-layer deterministic validator + selective AI verifier + golden regression + bounded regen + cached fallback |
| Generation cost variance blows the ceiling | batch-first, context minimization, caching, operation-level guardrail, RED controls |
| `LearningContext` type change ripples widely | keep `standardPosition`/`actualTaughtPosition` aliases; superset shape; step B2 compiles all consumers |
| Calendar data wrong for the pilot school | window not a point; resolver discounts `ESTIMATED`; parent confirm affordance; `pace_delta` self-corrects |
| Deleting the bank path breaks the demo | flags on every flip; delete only after a green release (C7) |
| Golden drift temptation | §O — report mismatch / `CONTENT_REVIEW_REQUIRED`, never edit expected |

---

## Stop condition

Phases 1–3 (docs 12–17) complete = **STOP**. Present to anh. No implementation
until APPROVE.
