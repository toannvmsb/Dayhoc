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

### C3 — `GeneratedExerciseValidator` (`@copilot/exercise-gen`) — ✅ DONE (2026-09-01)
- **Goal:** deterministic gate: schema, known IDs, K/T range, prereq safety, above-grade rule, answerability, uniqueness, hint ladder, safety/age/language, batch distribution.
- **Files:** new `packages/exercise-gen/` (`validator.ts` `validateGeneratedBatch`); `@copilot/domain` gains `GeneratedExercise`, `GeneratedExerciseBatch`, `ValidationOutcome`, `EXERCISE_VALIDATION_REASON_CODES`, `ExerciseFinding`, `BatchValidationResult` + `schoolGrade` on the spec; `@copilot/schemas` gains `generatedExerciseSchema` / `generatedExerciseBatchSchema`; `exercise-spec.ts` takes `gradeContext`.
- **Deps:** C1 (spec), C2 (KB access).
- **DB / API:** none.
- **Outcome model:** per finding → `PASS | REPAIRABLE | REGENERATE | BLOCK` (worst wins). Result carries `reasonCodes[]`, `findings[]` (each with `questionIds`, `detail`, optional `repairInstruction`), `acceptedItems` (zero-finding items only — the sole ones that may reach an `Assignment`), `shortfall`, `validatorVersion`.
- **Reason codes → default outcome:** `UNKNOWN_SKILL_ID` / `UNLEARNED_REQUIRED_KNOWLEDGE` / `ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED` / `UNSAFE_CONTENT` / `NOT_AGE_APPROPRIATE` / `SCHEMA_INVALID` → **BLOCK**; `OUTSIDE_K_RANGE` / `OUTSIDE_T_RANGE` / `CHALLENGE_EXCEEDS_SPEC` / `SKILL_NOT_IN_SPEC` / `ANSWER_INCONSISTENT` / `DUPLICATE_VARIANT` / `DISTRIBUTION_MISMATCH` → **REGENERATE**; `MISSING_RUBRIC` / `HINT_LADDER_MALFORMED` / `UNKNOWN_PROBLEM_TYPE` / `PROBLEM_TYPE_SKILL_MISMATCH` / `ANSWER_UNVERIFIABLE` / `LANGUAGE_MISMATCH` → **REPAIRABLE**.
- **Tests:** `validator.test.ts` — TEST 8 (unknown skill BLOCKs its item, the batch still delivers the rest), K-range, blocking-prereq, prereq-repair exemption, near-duplicate, hint-ladder, reasoning rubric, choice inconsistency, above-grade allow/deny, distribution mismatch, unknown problem type, purity. `golden/generated-validator.test.ts` — every reference-library item is accepted (no false positives); every golden-question skill id resolves; an invented id always BLOCKs.
- **Acceptance:** no item with any finding is in `acceptedItems`; `validateGeneratedBatch` is pure over (batch, spec, KB). No live generator — validated against deterministic fixtures.

### C3.1 — validator / spec hardening — ✅ DONE (2026-09-01)
- **Thinking Level** — `assessThinking()`; T range from demonstrated level + evidence, then goal + readiness. HSG + ready + strong thinking → controlled 2-step stretch (T4/T5 reachable, T5 ≠ above-grade K). HSG + weak thinking → no auto T5. Strong thinking + school goal → thinking-challenge slot, T capped T4.
- **`requiredSkillIds`** — `GeneratedExercise` gains it (+ optional `supportingSkillIds`); validator checks identity + closure of the *required* set; a weak unrelated prerequisite no longer blocks. `UNKNOWN_REQUIRED_SKILL_ID` → BLOCK.
- **Item vs batch** — `ItemValidationOutcome` vs `BatchDisposition` (`DELIVER | REPAIR | REGENERATE_SLOTS | QUARANTINE`); contract violations quarantine; `deliverable` only when every slot valid AND count === `totalQuestions` (no silent partial). `itemOutcomes` map.
- **Provenance** — removed hard-coded version. `KnowledgeBase.provenance` (`datasetRevision` + deterministic `contentHash`); spec records `curriculumRevision` + `curriculumContentHash`. `build-kb.mjs` emits `meta`.

### C4 — `ExerciseGenerator` contract + Grounding + Mock generator + Orchestrator — ✅ DONE (2026-09-01)
- **Goal:** `spec → grounding → 1 batch call → N items → validate → repair/regenerate (bounded) → FinalValidatedBatch OR structured failure`. **No live AI.**
- **Files (all `@copilot/exercise-gen`):** `generator.ts` (`ExerciseGenerator` interface, `GenerationRequest`, `GenerationOutcome`, `GenerationInability`, `SlotRequest`), `grounding.ts` (`GenerationGrounding` + deterministic `buildGenerationGrounding`), `mock-generator.ts` (`createMockExerciseGenerator`), `repair.ts` (reason code → deterministic instruction; `slotRequestsFor`), `telemetry.ts` (`GenerationOperation` + `generationOperationToUsageEvent`), `orchestrator.ts` (`orchestrateGeneration`, bounded state machine), `persistence.ts` (`GenerationStore` port + `InMemoryGenerationStore` + `toGenerationRecords`). Package deps += `@copilot/ai`, `@copilot/reference-library`.
- **§F education-dumb** — the generator receives only a `GenerationGrounding`; it cannot change skills/targets/problem types/K-T/distribution/gap-repair/advanced/goal/readiness/frontier. On inability → structured `GenerationInability`, never an altered spec.
- **§G privacy** — grounding carries NO child/parent/school name, no twin, no learning history, no evidence; only `generationSpecId`, grade, target skill defs + problem types, prereq context, K/T semantics, ≤3 reference examples (metadata only), forbidden skills, output schema name.
- **§J bounded** — `maxGenerationAttempts` (default 2) fresh batches after QUARANTINE/inability; `maxRepairAttempts` (default 2) slot rounds per batch. Never infinite retry.
- **§K repair policy** — validator reason code → deterministic instruction (`repair.ts`); the validator's free-text `detail` is never piped to the generator.
- **§L persistence** — migration `1757030400000_generated_exercises.js` — `generation_specs` (⊕) + `generated_exercise_sets` (⊕, append-only triggers). up/down/up verified. `toGenerationRecords()` maps an orchestration run to the rows; every set traces back to its spec. `cost_event_ref` nullable.
- **§M cost** — every generator call (Mock included) emits a `GenerationOperation` with `operationType: 'worksheet_batch_generation'`, provider `mock`, model `mock`, cost 0; `generationOperationToUsageEvent()` maps it to `AiUsageEvent` unchanged. C5 swaps the generator for Luna with no orchestrator rewrite.
- **Tests:** `grounding.test.ts` (§11 no PII, §12 only-relevant, §13 no verbatim, forbidden-skills), `mock-generator.test.ts` (validator-clean batch, deterministic, no verbatim, K/T in range, inability), `orchestrator.test.ts` (happy path, §9 count after regen, §10 bounded failure + inability, §14 traceable, §16 telemetry, §L records). 388 pass / 2 skip.
- **Feature flag / rollback:** nothing in the runtime calls `orchestrateGeneration` yet (C5). The Mock generator is the only implementation; `@copilot/ai` `LunaExerciseGenerator` is C5.
- **Acceptance:** `orchestrateGeneration` produces a validated `GeneratedExerciseBatch` from a spec via the Mock generator, or a structured failure; the Mock does not bypass the validator.

### C4.1 — target selection + generation pipeline hardening — ✅ DONE (2026-09-01)
- **Goal:** fix report risk #2 — `targets.skillIds` = resolved-lesson skills is not enough; the planner must deterministically select FRONTIER skills; AI never selects them.
- **Files:** `packages/domain/src/exercise-gen.ts` (`TargetSkill`/`TargetRole`/`BUCKET_ROLE`, `DomainFrontierView`, `targets.skills`, `provenance.targetSelectorVersion`, 3 new reason codes), `packages/domain/src/twin.ts` (`DomainFrontier` +`confidence`/`masteredSkillIds`/`readyNextSkillIds`/`exposureSkillIds`), `packages/learning-twin/src/twin.ts` (compute them; frontier confidence = mastered skills AT the reached origin, not domain-average), `packages/planning/src/target-selector.ts` (new — `selectLearningTargets`, `assessThinking`, `TARGET_SELECTOR_VERSION`), `packages/planning/src/exercise-spec.ts` (use the selector; `advanced` bucket ⟺ FRONTIER target, `thinkingChallenge` ⟺ THINKING target; K ceiling from the frontier target, not the goal), `packages/schemas/src/exercise-generation.schema.ts`, `packages/exercise-gen/src/{grounding,validator,mock-generator,telemetry,orchestrator,persistence}.ts`, `packages/ai/src/usage-event.ts` (`actualCost*`), migration `1757116800000_cost_actuals_and_target_provenance.js`.
- **Target roles:** `CURRENT` (resolved lesson) → currentSkill/variation/application · `PREREQUISITE_REPAIR` (gap/readiness prereqs) → prerequisiteRepair · `FRONTIER` (real above-grade skills the frontier + readiness + blocking-gap state support) → advanced · `THINKING` (grade-level skills with T4/T5 problem types) → thinkingChallenge.
- **Frontier rules:** domain `aboveGrade` + `confidence ≥ 0.3`; candidate's prereq closure ∩ blocking gaps = ∅; already-mastered skill OK, "ready next" needs in-domain direct prereqs mastered; `curriculumOrigin > schoolGrade`; count/K-ceiling gated by parent goal + frontier confidence (`≥ 0.55` → K5, else K4); low-confidence frontier → **no** frontier target.
- **ADVANCED KNOWLEDGE vs ADVANCED THINKING:** the `advanced` bucket = K4/K5 on FRONTIER targets; `thinkingChallenge` = T4/T5 on grade-level K. Parent goal never lifts K on its own.
- **Validator:** `TARGET_ROLE_MISMATCH` (bucket used with a skill outside its binding → REGENERATE); `FRONTIER_SKILL_NOT_SELECTED` (above-grade skill the planner didn't pick → BLOCK → QUARANTINE); `REQUIRED_SKILL_OUT_OF_BOUNDS` (requiredSkillIds outside the item target's closure → BLOCK). `grounding.bucketBindings` carries the mapping.
- **Cost telemetry:** `estimatedCost*` (forecast, `forecastByOperation` + budget) vs `actualCost*` (ledger source of truth; `rollup`/`cogsPerUser`/`measuredUnitCosts` prefer actual). Migration adds `ai_usage_events.actual_cost_usd/vnd` + `generation_specs.target_selector_version`. up/down/up verified.
- **Mock E2E:** numeric / fraction / reasoning-with-rubric answer formats; honours `bucketBindings`.
- **Tests:** `target-selector.test.ts` (§1 same lesson diff frontier, §2 above-grade algebra selectable, §3 geometry doesn't inherit algebra, §4 Parallel Gap Repair, §5 blocking prereq on frontier → rejected, §6 HSG w/o frontier evidence → no above-grade, §8 low-confidence → conservative), `exercise-spec.test.ts` §7 (strong T + no above-grade K → T4/T5 grade K, advanced=0), `validator.test.ts` §14.9/10 + out-of-bounds, `mock-generator.test.ts` §6/10/13, `orchestrator.test.ts` §11/12/13/15 + provenance. **403 pass / 2 skip.**
- **No live provider.**

### C4.2 — learning context / frontier separation + Next Safe Frontier validation — ✅ DONE (2026-09-01)
- **Goal:** fix report risk #1 — a synthetic enrichment/HSG node (`C.G7.EXT.0`) must never become `resolved.lessonId`; a demonstrated above-grade skill's frontier target should normally be the NEXT SAFE bridge, not the highest origin reached.
- **Files:** `packages/math-data/src/schema.ts` (`CURRICULUM_NODE_TYPES`, `curriculumNodeSchema.nodeType` default `CORE_CURRICULUM`, `isEligibleForCurrentLearningContext`), `packages/math-data/scripts/build-kb.mjs` (real SGK nodes → `CORE_CURRICULUM`, the `EXT.0` fallback → `ADVANCED`), `packages/learning-context/src/resolver.ts` (`eligibleAsContext` gate on every signal source), `packages/domain/src/exercise-gen.ts` (`TARGET_SELECTION_REASONS`, `TargetSkill.selectionReason/selectedCurriculumOrigin/frontierEvidenceOrigin?/selectionConfidence`), `packages/planning/src/target-selector.ts` (rewrite — NEXT_SAFE vs MASTERED_STRETCH split, `LearningTargets.trace`, thinking fallback, `TARGET_SELECTOR_VERSION = target-selector.v2`), `packages/schemas/src/exercise-generation.schema.ts` (schema for the 4 new `TargetSkill` fields).
- **Context eligibility:** `nodeType: CORE_CURRICULUM | ENRICHMENT | ADVANCED | HSG | DIAGNOSTIC | REFERENCE`; only `CORE_CURRICULUM` is eligible. The resolver filters lesson confirmations, teacher/parent contributions, AND observed evidence through this check — a confirmation cannot name an ineligible node as the current lesson either.
- **Next Safe Frontier:** per domain, candidates are `readyNextSkillIds` (→ `NEXT_SAFE_FRONTIER`, sorted nearest-origin-first) then `masteredSkillIds` above grade not already covered (→ `MASTERED_FRONTIER_STRETCH`, sorted highest-origin-first); a candidate whose prerequisite closure intersects a blocking gap is rejected with an explicit reason, even if it is itself already mastered. `frontierEvidenceOrigin` (the domain's highest demonstrated origin) is recorded separately from each target's own `selectedCurriculumOrigin`.
- **No global unlock:** frontier candidates come only from the twin's graph-computed `masteredSkillIds`/`readyNextSkillIds` (never "all skills ≤ reachedCurriculumOrigin") — an above-grade, same-domain, same-node skill whose own prerequisite path isn't satisfied stays rejected regardless of `reachedCurriculumOrigin`.
- **Thinking fallback:** direct T4/T5 problem type on a CURRENT skill first; else a same-domain grade-level skill (dependent/prerequisite of CURRENT) whose own direct prerequisites are mastered and which itself carries a T4/T5 problem type (`THINKING_ADJACENT_FALLBACK`); else no thinking target (never fabricated).
- **Tests:** `target-selector.test.ts` (unchanged, still 7/7 green against the v2 selector) + new `packages/testing/src/golden/context-frontier-separation.test.ts` (12 tests — §7 full traceable example: EXT node never becomes resolved lesson, frontier still updates, teacher confirmation of an eligible node wins, EXT confirmation rejected, `reachedCurriculumOrigin=9` doesn't unlock a graph-disconnected sibling skill, Grade-8 bridge preferred over Grade-9 evidence, a mastered bridge enables a Grade-9 NEXT_SAFE pick, blocking-gap rejection with explicit reason, full selection provenance, thinking fallback used/not-fabricated, Context and Frontier independently reproducible from raw evidence). **415 pass / 2 skip.**
- **No live provider.**

### C5 — LIVE AI GENERATION IN SHADOW MODE — ✅ DONE (2026-09-01), no live run
- **Goal (as re-scoped by anh):** NOT flip the practice path. MEASURE whether a live model can satisfy the deterministic contract at acceptable quality / reliability / latency / cost. Legacy Practice → Child stays the only production path; the shadow path runs in parallel and never reaches a child. Full spec: [18_LIVE_AI_GENERATION_SHADOW_MODE.md](18_LIVE_AI_GENERATION_SHADOW_MODE.md).
- **Files:** `packages/ai/src/config.ts` (env config + key resolver), `packages/ai/src/providers/openai-adapter.ts` (`createOpenAiProviderAdapter` — the only OpenAI-aware file), `packages/ai/src/provider.ts` (`StructuredAIInput.system?`), `packages/exercise-gen/src/luna-generator.ts` (`LunaExerciseGenerator` + `exercise-generator-prompt.v1`), `.../cost.ts` (`computeActualCost`), `.../answer-verification.ts`, `.../verifier.ts`, `.../shadow.ts` (mode + queue port + runner), `.../shadow-metrics.ts`, `.../pg-persistence.ts` (`@copilot/exercise-gen/pg`), `.../generator.ts` (`GenerationUsage`, `promptVersion`), `.../telemetry.ts` + `.../orchestrator.ts` (usage → actual cost, new op fields), `.../validator.ts` + `packages/domain/src/exercise-gen.ts` (`REFERENCE_EXAMPLE_COPY`, `AI_GENERATION_MODES`, `ANSWER_VERIFICATION_LEVELS`), `services/api/src/api.ts` (`shadowGeneration` deps + `maybeRunShadowGeneration` in `childToday`), `packages/testing/src/benchmark/luna-generation-benchmark.ts`.
- **Deps:** C1–C4.2, B3.
- **DB:** none new — `generation_specs` / `generated_exercise_sets` already hold it (spec jsonb + trace jsonb). `PgGenerationStore` integration test verified against the portable Postgres.
- **API:** no route change. `childToday` returns the legacy assignment unchanged, THEN enqueues a shadow run when `shadowGeneration.mode === 'SHADOW'`.
- **Config:** `AI_GENERATION_DEFAULT_PROVIDER` / `AI_GENERATION_DEFAULT_MODEL` / `AI_PRICING_CONFIG_VERSION` / `AI_GENERATION_MODE` (`OFF` default). Key from `OPENAI_API_KEY` only, read fresh, stored nowhere.
- **Tests:** `packages/exercise-gen/src/c5-live-generation.test.ts` (20 — §23 items 1–4, 9–24, all with a fake adapter, no network), `services/api/src/api.test.ts` (+6 — §23 items 5–8: SHADOW output == legacy, shadow failure never reaches child, OFF/LIVE never generate, shadow runs off the request path), `packages/ai/src/providers/openai-adapter.test.ts` (3 — delimited request, JSON-mode, error surfacing, no key in config), `packages/testing/src/benchmark/luna-generation-benchmark.test.ts` (3 + 1 live-skip — synthetic-only specs, harness end-to-end on a deterministic adapter), `packages/exercise-gen/src/pg-persistence.integration.test.ts` (1, DB-gated). **446 pass / 5 skipped** (2 live-benchmark, 2 pg-integration, 1 pre-existing).
- **Golden:** unchanged.
- **Not done:** LIVE mode not activated · no live provider run (no key in the build env) · advanced provider stays OPEN_PENDING_BENCHMARK · legacy practice path intact · no NBQ · Reference Library intact.

### C5.1 — benchmark readiness hardening — ✅ DONE (2026-09-01), no live run
- **Goal:** make the Luna benchmark trustworthy before spending a cent — answer verification must distinguish FORMAT from CORRECTNESS; structured output must be honest about strict-vs-fallback; every benchmark result must be versioned and reproducible; a spend guardrail must exist.
- **Files:** `packages/domain/src/exercise-gen.ts` (`ANSWER_VERIFICATION_LEVELS` → `FORMAT_VERIFIED | DETERMINISTIC_CORRECTNESS_VERIFIED | AI_CROSSCHECK_REQUIRED | HUMAN_GOLDEN_VERIFIED | UNVERIFIED`), `packages/exercise-gen/src/math-verifier.ts` (NEW — narrow bigint-rational arithmetic verifier), `.../answer-verification.ts` (rewrite — FORMAT vs CORRECTNESS), `.../validator.ts` (`ANSWER_INCONSISTENT` on a proven-wrong supported expression), `.../verifier.ts` (`deterministic_verifier_unresolved` trigger uses the real verifier), `.../shadow-metrics.ts` (`answerFormatValidRate` / `answerDeterministicCorrectnessVerifiedRate` / `answerCrosscheckRequiredRate` / `answerUnverifiedRate`), `packages/ai/src/config.ts` (`AI_GENERATION_STRUCTURED_OUTPUT_MODE`, `LIVE_BENCHMARK_MAX_BATCHES`, `LIVE_BENCHMARK_MAX_COST_USD`), `packages/ai/src/provider.ts` + `providers/openai-adapter.ts` (strict `json_schema` mode + honest downgrade + reported mode), `packages/schemas/src/generated-exercise.jsonschema.ts` (NEW — hand-authored `GENERATED_BATCH_JSON_SCHEMA` v1), `packages/exercise-gen/src/{generator,telemetry,orchestrator,luna-generator}.ts` (`GenerationProviderMeta`, `structuredOutputMode` / `outputSchemaName` / `outputSchemaVersion` on every op), `packages/testing/src/benchmark/luna-benchmark-manifest.ts` (NEW — frozen manifest + coverage), `.../luna-generation-benchmark.ts` (rewrite — spend guardrail + `BenchmarkReport` machine-readable output).
- **Math verifier scope:** integer / decimal / fraction arithmetic, `+ - × · * / :`, parentheses, `−`/`–` normalized. Extracts ONLY a closed expression that is essentially the whole prompt; estimation wording / blanks / prose → `UNSUPPORTED` (never a guess). `choice` mismatch → `UNSUPPORTED` (never `INCORRECT` — "closest to" risk). 3 real reference-library false positives fixed.
- **Structured output:** default `JSON_OBJECT_FALLBACK`; `STRICT_JSON_SCHEMA` sends `response_format: json_schema` only when a schema is supplied, else honest downgrade; the mode actually used is recorded on the op + report.
- **Benchmark manifest:** `BENCHMARK_MANIFEST_VERSION`, 16 golden profiles (8 G4 + 8 G7), coverage report EXPOSES gaps (no strong FRONTIER / T4-T5 profiles in the golden dataset).
- **Spend guardrail:** `runLunaBenchmark` stops before `maxBatches` / `maxCostUsd`; live test `describe.skipIf(!RUN_LIVE_AI_BENCHMARK)` + key check.
- **Tests:** `c5-live-generation.test.ts` (+11 — FORMAT ≠ CORRECTNESS, math verifier CORRECT/INCORRECT/UNSUPPORTED, wrong answer rejected by validator, strict mode + reported mode, schema/prompt version persisted, reference-copy exact/mutation/different, spend-guardrail defaults), `luna-generation-benchmark.test.ts` (rewrite — manifest synthetic-only, harness machine-readable report, guardrail stops early, no paid call), `openai-adapter.test.ts` (+1 — strict json_schema + downgrade), `generated-validator.test.ts` golden (unchanged, still green — the 3 authored-content false positives now pass). **460 pass / 5 skipped.**
- **Not done:** no live provider run (no key) · LIVE not activated · legacy path intact · no NBQ · no Terra/Sonnet · no pricing change · no OCR.

### C5.2 — benchmark coverage hardening — ✅ DONE (2026-09-02), no live run
- **Goal:** make the Luna benchmark representative of DạyZi's educational differentiators before spending money — grade-level T4/T5, real above-grade FRONTIER, Parallel Gap Repair, safe frontier progression, conservative behaviour under uncertainty, and generator/validator resistance to contract violations.
- **Files:** `packages/domain/src/exercise-gen.ts` (`AI_CROSSCHECK_PASSED/FAILED` reserved, `CORRECTNESS_GROUND_TRUTH_LEVELS`, `REFERENCE_EXACT_COPY` code), `packages/exercise-gen/src/reference-similarity.ts` (NEW — `classifyReferenceCopy` EXACT/NEAR/NONE, deterministic), `.../validator.ts` + `.../repair.ts` (exact-vs-near reference-copy), `.../answer-verification.ts` + `.../shadow-metrics.ts` (`exactReferenceCopyRate`/`nearReferenceCopyRate`, new level keys), `.../c5-adversarial.test.ts` (NEW — 15 adversarial cases), `packages/testing/src/benchmark/luna-hardcase-manifest.ts` (NEW — HC01–HC08 built through the real pipeline), `.../luna-benchmark-coverage.ts` (NEW — `computeCoverageMatrix`, `probeAnswerCoverage`, `assessBenchmarkReadiness`), `.../luna-generation-benchmark.ts` (base+hard cases, coverage + readiness in the report, exact reference-copy HARD GATE).
- **Hard cases:** each has a machine-checkable `expect` block; HC05→HC06 is a paired state transition (blocking bridge → mastered bridge unlocks a next-safe frontier). All 8 pass.
- **Adversarial:** the validator catches all 15; it was NOT weakened.
- **Reference copy:** EXACT = whitespace-collapsed string equality (HARD GATE, rate must be 0); NEAR = normalized (digit/case/punct) string equality (gate ≤ 1%). False-positive risk noted.
- **Answer semantics LOCKED:** `FORMAT_VERIFIED ≠ DETERMINISTIC_CORRECTNESS_VERIFIED`; AI cross-check is never deterministic correctness; `CORRECTNESS_GROUND_TRUTH_LEVELS` = deterministic + human-golden only.
- **Coverage / readiness:** full matrix (grade / roles / K1–K5 / T1–T5 / context confidence / goals / Parallel Gap Repair / above-grade frontier / grade-level T4/T5 / answer formats / verification levels); every uncovered cell listed (`coverage.uncovered`), no hidden GAP. `assessBenchmarkReadiness` → `benchmarkReady: true` (blocking gaps: none; non-blocking: K5, ESTIMATED context, kha_gioi goal, mock-only answer-format gaps).
- **Tests:** `c5-adversarial.test.ts` (16), `luna-generation-benchmark.test.ts` rewrite (16 — HC expectations, HC05→HC06 transition, coverage matrix, readiness true/false, exact-copy hard gate, machine-readable report). **487 pass / 5 skipped.**
- **Not done:** no live provider run · LIVE not activated · legacy path intact · no NBQ · no Terra/Sonnet · no pricing change · no OCR · no second-pass AI verifier call.
- **Command that WOULD run the paid benchmark later (after anh's explicit go):**
  `OPENAI_API_KEY=sk-… RUN_LIVE_AI_BENCHMARK=1 LIVE_BENCHMARK_MAX_BATCHES=24 LIVE_BENCHMARK_MAX_COST_USD=5 AI_GENERATION_STRUCTURED_OUTPUT_MODE=STRICT_JSON_SCHEMA npx vitest run packages/testing/src/benchmark/luna-generation-benchmark.test.ts`

### C5b — flip the practice path (was "C5") — NOT STARTED
- **Goal:** `buildDailyPlan` also emits spec(s); `generateWorksheet(plan)` replaces `buildAssignmentsForPlan`; `AI_GENERATION_MODE = LIVE` after the shadow benchmark passes anh's review.
- **Deps:** C5 benchmark reviewed + approved by anh.
- **Rollback:** `AI_GENERATION_MODE` flag (`SHADOW` → `LIVE`); old bank path kept one release, deleted in C7.

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
