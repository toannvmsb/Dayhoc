# 16 — Architecture Migration Changelog (AI-Generation-First)

> Precise "what changes" record for the v1.0 → v1.1 migration. Companion to
> [12 Audit](12_ARCHITECTURE_MIGRATION_AUDIT.md), [13 Clock/Resolver](13_CURRICULUM_CLOCK_AND_CONTEXT_RESOLVER.md),
> [14 Generation](14_AI_EXERCISE_GENERATION_ARCHITECTURE.md), [15 Cost/Routing](15_AI_COST_AND_MODEL_ROUTING.md).
> Implementation sequencing is in [17](17_IMPLEMENTATION_MIGRATION_PLAN.md).
>
> **Progress (2026-09-01):** Group A ✅ · B1+B2+B3 ✅ · pace policy ✅ (doc 13 §4)
> · **C1** `ExerciseGenerationSpec` + builder ✅ · **C2** reference library ✅ ·
> **C3** `GeneratedExerciseValidator` ✅. 357 tests. C4+ (live generator, runtime
> flip, adaptive mode) not started — awaiting anh's approval of C1–C3.

---

## 1. Decisions changed

| v1.0 | v1.1 |
|---|---|
| Authored Question Bank is the primary practice source; AI generation layered on later | **AI-Generation-First**. Bank → Reference/Grounding Library only |
| App has no calendar model; current lesson only known from parent/teacher | **CurriculumClockService** estimates it; **LearningContextResolver** merges all signals by reliability |
| Planner emits `PlannedAction`s; `buildAssignment` filters the bank | Engine emits a full **`ExerciseGenerationSpec`** before any AI call |
| (implicit) one AI call per question | **Worksheet = 1 batch call**; adaptive = event-driven Next-Best-Question |
| Routing has a plan flavour; "BASIC=Luna, PLUS=advanced allowed" | **Plan never selects the model**; educational need + confidence + difficulty do |
| AI cost = tokens/user; 2 thresholds; GREEN/YELLOW/RED | Cost = Σ(operation × unit cost × retry factor); **3 thresholds**; **GREEN/YELLOW/RED/BLOCKER** |
| AI target/ceiling: FREE 1.5/2K, BASIC 6/8K, PLUS 14/18K, PRO 28/35K | FREE 2/3K, BASIC 8/10K, PLUS 15/22K, PRO 28/40K + absolute boundaries 12.25/27.25/52.25K |
| `PRICING_AND_COST_GUARDRAILS.md` authoritative | Superseded by `15_AI_COST_AND_MODEL_ROUTING.md` |

**Unchanged:** pricing 169/229/329K · margin formula · deterministic-engine
ownership · privacy architecture · Golden dataset expected outputs · Math Core.

---

## 2. Documents

| Doc | Change |
|---|---|
| `CLAUDE.md` | core loop → v1.1; "AI generation invariants" section; "AI cost invariants" → v1.1 numbers/states; question-bank → reference-library; P-04 note |
| `01_PROJECT_UNDERSTANDING.md` | §8.3 core loop replaced with the v1.1 LOCKED loop |
| `03_SYSTEM_ARCHITECTURE.md` | §4 core processing loop; §2 monorepo layout (+`curriculum-clock`, `exercise-gen`, `reference-library`); §5 AI cost/routing bullet → v1.1 |
| `04_DATABASE_MODEL.md` | new §1d: `curriculum_calendars`, `child_school_enrollment`, `learning_context_snapshots`, `generated_exercise_sets`, `ai_operation_cost_rollup`; `ai_usage_events` new columns; `teacher_contributions` + reliability |
| `05_API_CONTRACT_PLAN.md` | `GET /children/:id/learning-context` (expected+resolved+source+confidence); `POST …/confirm-lesson`; assignment payload carries inline generated questions |
| `06_AI_ORCHESTRATION_PLAN.md` | §2 generation row; §4 provider interface → `generateBatch(spec)`; §6 FREE fallback = cached/transform not static bank; §7 routing → `AIModelRouter`, remove "question-bank" tier |
| `07_MATH_ENGINE_PLAN.md` | new section: deterministic → `ExerciseGenerationSpec`; prescription feeds the spec |
| `08_GOLDEN_TEST_PLAN.md` | add generation/validator/clock/resolver/router/guardrail golden tests + TEST 1–13 |
| `10_IMPLEMENTATION_ROADMAP.md` | P5/P6 reordered to generation-first; new phases for clock/resolver/generation/cost-v1.1 |
| `11_RISKS_AND_OPEN_QUESTIONS.md` | R7 mitigation → deterministic spec + multi-layer validation + selective verifier; new risk: generation quality/cost variance |
| `PENDING_APPROVAL.md` | D-03 reframed; P-04 → v1.1; add the open questions from this migration |
| `PRICING_AND_COST_GUARDRAILS.md` | becomes a 5-line stub → "superseded by 15" |
| `QUESTION_BANK_PLAN.md` | becomes `REFERENCE_LIBRARY_AND_GROUNDING_PLAN.md` (or a stub pointer) |
| **new** | `13`, `14`, `15`, `16` (this), `17` |

---

## 3. Packages / services

| Package | Change |
|---|---|
| `@copilot/domain` | `Question.origin` +`'reference'`; `Assignment.questions[]`; new: `ExerciseGenerationSpec`, `GeneratedExercise`, `GenerationMode`, `NextBestMove`, `LearningContext` extended (`expected`/`resolved`/`paceDelta`), `CurriculumPosition` +`lessonId`, `TeacherContribution.reliability` |
| `@copilot/schemas` | new: `exerciseGenerationSpecSchema`, `generatedExerciseSchema`, `generatedBatchSchema` |
| **`@copilot/curriculum-clock`** (new) | `CurriculumClockService.positionFor(child, date)`; reads `curriculum_calendars` |
| `@copilot/learning-context` | add `LearningContextResolver.resolve(...)`; `buildLearningContext` becomes a thin wrapper that calls clock + resolver; keep `standardPosition`/`actualTaughtPosition` as aliases |
| `@copilot/planning` | new `buildExerciseGenerationSpec(input)`; `buildDailyPlan` also returns the spec(s); `nbla` distribution → spec `generation_plan.distribution` |
| **`@copilot/exercise-gen`** (new) | `GeneratedExerciseValidator`, `nextBestMove(policy)`, cached-set fallback |
| `@copilot/ai` | new `ExerciseGenerator` + `AiOrchestrator.runBatchGeneration`; `routing.ts` → `AIModelRouter` (plan≠model, advanced gate, v1.1 operation taxonomy); `budget.ts` → `AIBudgetGuardrail` (4 states, 3 thresholds); `margin.ts` → v1.1 `PLAN_COMMERCIALS` (+absolute boundary); `usage-event.ts` → `AICostLedger` (+new fields, operation forecast); `pricing.ts` keeps pattern, surfaces `effective_date` |
| **`@copilot/reference-library`** (renamed from `@copilot/practice` question-bank) | `loadReferenceLibrary()`, `groundingExamplesFor(...)`; `questions*.json` moved here |
| `@copilot/practice` | keep `hint-ladder`, `submission`, `offline-queue`; **delete** `assignment.ts` bank path; `stretch-zone` demoted to tie-breaker |
| `@copilot/math-data` | new `data/calendars/` → build into KB |
| `services/api` | new learning-context + confirm-lesson routes; assignment route returns inline generated content |
| `apps/web` | LearningContextCard shows estimated vs confirmed + confirm; demo scenes use a mock generator |

---

## 4. Database

| Migration | Content |
|---|---|
| new `..._curriculum_calendar_and_context.js` | `curriculum_calendars`, `child_school_enrollment`, `learning_context_snapshots` (⊕); add `reliability` to `teacher_contributions` |
| new `..._generated_exercises.js` | `generated_exercise_sets` (spec_id, items jsonb, validation_result, model, created_at), `generation_specs` (⊕ audit) |
| new `..._ai_cost_v1_1.js` | `ai_usage_events` add `model_version`, `price_config_effective_date`, `generation_spec_id`, `learning_context_source`, `k_target`, `t_target`, `escalated_from`; new `ai_operation_cost_rollup`; update `ai_pricing_registry` seed to v1.1 targets/ceilings/boundaries (in a config table, not code) |

All additive. No column drops in the migration set; obsolete columns marked
deprecated and removed only after a full release cycle.

---

## 5. API

| Endpoint | Change |
|---|---|
| `GET /children/:id/learning-context` | **new** — `{expected, resolved, paceDelta, conflicts}` |
| `POST /children/:id/confirm-lesson` | **new** — parent confirms/corrects the estimated lesson |
| `POST /children/:id/assignments` (or the daily-plan endpoint) | response now carries `assignment.questions[]` (inline generated) + `generationSpecId` |
| `POST …/attempts` | unchanged shape; evidence gains `generationSpecId` |
| teacher/parent update endpoints | input gains optional `confidence`/`reliability` hint |
| any internal AI endpoint | must emit an `AICostLedger` row |

---

## 6. Tests added

| File | Covers |
|---|---|
| `curriculum-clock.test.ts` | TEST 1–3, idempotent replay |
| `context-resolver.test.ts` | reliability weighting, no "latest wins", verified-not-overwritten |
| `exercise-spec.test.ts` | TEST 4, 5, 6 (batch), personalization determinism |
| `generated-validator.test.ts` | TEST 8 (unknown id), 9 (low-confidence), range/prereq/uniqueness gates |
| `next-best.test.ts` | TEST 7 (diagnostic pivot) |
| `model-router.test.ts` | TEST 10 (PRO standard → default), 11 (BASIC T5 → escalate) |
| `budget-guardrail.test.ts` | TEST 12 (RED), 13 (BLOCKER); retry-loop cannot cross ceiling |
| `margin.test.ts` (rewrite) | v1.1 numbers from `pricing_guardrails_v1.1.yaml` |
| `budget.test.ts`, `routing.test.ts`, `usage-event.test.ts` (rewrite) | v1.1 shapes |
| `practice.test.ts`, `pipeline.test.ts` (rework) | generation path via mock generator |
| E2E Family Journey (extend) | TEST 1 in a journey; add `generationSpecId` assertions — **expected outputs unchanged** |

---

## 7. Code at risk of obsolescence

| Item | Fate |
|---|---|
| `packages/practice/src/assignment.ts` (`buildAssignment`, `buildAssignmentsForPlan`) | deleted after generation path passes golden |
| `packages/practice/src/stretch-zone.ts` `selectStretchSet` | kept as tie-breaker only |
| `packages/practice/src/data/questions*.json` as a delivery bank | repurposed → reference library |
| `PRICING_AND_COST_GUARDRAILS.md`, `QUESTION_BANK_PLAN.md` | superseded / stubbed |
| `marginLight` (3-state) | replaced by 4-state guardrail |
| `AI_OPERATIONS` (v1.0 enum), `estimateCostUsd` w/o operation attribution | replaced |
| `RouteContext` if it grows a `plan`-based model branch | forbidden — plan → budget only |

---

## 8. Sequencing

See [17](17_IMPLEMENTATION_MIGRATION_PLAN.md). Principle: **never break the
running demo**. Each step lands behind the existing path, passes golden + new
tests, then flips the default and deletes the old path.
