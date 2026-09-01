# 12 — Architecture Migration Audit (AI-Generation-First)

> **Trigger:** `File du an/AI_Parent_Learning_Copilot_Pricing_AI_Cost_Routing_v1.1.zip`
> (Pricing + AI Cost Guardrails + Model Routing **v1.1**), locked by anh 2026-09-01.
> v1.1 **supersedes** v1.0 wherever they conflict. Core change: **`AI_GENERATION_FIRST`**.
>
> **This document is PHASE 1 (audit only). No code changed.** It maps every place
> the old assumptions live so Phase 2 (spec update) and Phase 3 (migration plan)
> are complete. See [16_ARCHITECTURE_MIGRATION_CHANGELOG.md](16_ARCHITECTURE_MIGRATION_CHANGELOG.md)
> and [17_IMPLEMENTATION_MIGRATION_PLAN.md](17_IMPLEMENTATION_MIGRATION_PLAN.md).

---

## 0. What actually changes vs what stays

### Stays the source of truth (unchanged)
- Product Blueprint, Technical Architecture, Math Core G4/G7.
- Golden datasets: Question, Error, Learning Twin & Planner, E2E Family Journey —
  **expected outputs are not edited** (§O of the prompt). New tests are added.
- Deterministic engine ownership: skill IDs, prerequisite DAG, K/T, mastery,
  gap taxonomy + lifecycle, readiness, planner constraints, privacy architecture.
- Pricing: **169K / 229K / 329K** (unchanged).
- Privacy-by-Design (P-05) — every constraint holds; AI-gen changes must not weaken it.

### The migration (v1.0 → v1.1)
| # | Old assumption | New rule (v1.1) |
|---|---|---|
| A1 | **Question-Bank-first** — practice is served from a static authored bank; AI generation is "layered on later" (`authored-first`) | **AI-Generation-First** — every ordinary personalized exercise is AI-generated to the child's current state. A Golden/Reference Problem Library exists only for grounding / examples / validation / generator eval / golden tests. |
| A2 | Verified Question Bank is the primary delivery mechanism (`loadQuestionBank` → `buildAssignment`) | Primary delivery = `ExerciseGenerationSpec → ExerciseGenerator → GeneratedExerciseValidator → Assignment`. |
| A3 | The app only knows the current lesson when a parent/teacher updates it (`buildLearningContext` `standardPosition` = whole-grade, `note: 'lịch trình theo tuần chưa được cấu hình'`) | **`CurriculumClockService`** estimates the current lesson from the academic calendar; **`LearningContextResolver`** merges estimate + all observed evidence with source-reliability weighting. Never "latest record wins". |
| A4 | The planner/NBLA emits `PlannedAction`s; `buildAssignment` turns an action into a question set by filtering the bank | The deterministic engine emits a full **`ExerciseGenerationSpec`** (target skills, distribution, K/T ranges, constraints) BEFORE any AI call. |
| A5 | One AI call per question would be the natural generation shape (no batch contract) | **Worksheet Mode = one batch generation call** for N questions + answers + solutions + metadata. **Interactive Adaptive Mode** = event-driven Next-Best-Question after new evidence. Tracked as separate operation types. |
| A6 | Model routing has an implicit plan flavour (`RouteContext.plan`, `checkBudget(plan)`); doc §"BASIC — Luna-first / PLUS — advanced allowed" | **Plan tier never selects the model.** Educational need + confidence + difficulty select it. Plan only sets the **budget envelope**. |
| A7 | AI cost = token/user; margin model = 2 thresholds (target, "hard ceiling"); traffic light GREEN/YELLOW/RED | Cost = **Σ(operation volume × unit cost × retry/escalation factor)**. **3 thresholds**: target < operational ceiling < absolute-50%-boundary. Budget states **GREEN / YELLOW / RED / BLOCKER** (4). |
| A8 | AI targets/ceilings: FREE 1.5K/2K · BASIC 6K/8K · PLUS 14K/18K · PRO 28K/35K | FREE 2K/3K · BASIC 8K/10K · PLUS 15K/22K · PRO 28K/40K. Plus absolute boundaries BASIC 12.25K · PLUS 27.25K · PRO 52.25K. |
| A9 | `PricingRegistry` carries model prices; telemetry `AiUsageEvent` has provider/model/tokens/cost | Telemetry must also carry `model_version`, `price_config_effective_date`, `generation_spec_id`, `learning_context_source`, `K_target`, `T_target`, `escalated_from`. Forecast by operation dimension. |
| A10 | No named services for router / guardrail / ledger — logic is loose functions | Formalize: `CurriculumClockService`, `LearningContextResolver`, `ExerciseGenerationSpec`, `ExerciseGenerator`, `GeneratedExerciseValidator`, `AIModelRouter`, `AIBudgetGuardrail`, `AICostLedger`. |

---

## 1. Question-Bank-first assumption

### 1.1 Code

| Location | What it does | Conflict | Migration action | Risk |
|---|---|---|---|---|
| `packages/practice/src/question-bank.ts` | `loadQuestionBank()` merges `questions.json` + `questions.ai-draft.json` → validated `Question[]`; `questionsForSkill()` | This IS the "static question bank as primary delivery". | **Repurpose** as `@copilot/reference-library` (grounding/examples/validation/golden only). Rename exports; keep the schema. Not the practice path. | Med — `buildAssignment`, web `child-scene`, golden tests import it. |
| `packages/practice/src/assignment.ts` | `buildAssignment` filters the bank by `targetSkillId`, `selectStretchSet`, returns `Assignment{questionIds}`; `buildAssignmentsForPlan` | The delivery mechanism is "pick from bank". Returns `null` "when the bank has nothing (Pending D-03)". | **Replace** with `buildExerciseGenerationSpec(...)` (deterministic) → `ExerciseGenerator.generate(spec)` → `GeneratedExerciseValidator` → `Assignment{questions}` (inline, not ids into a bank). | High — central to the practice loop; touches domain `Assignment`, web, pipeline test. |
| `packages/practice/src/stretch-zone.ts` | `selectStretchSet(twin, pool, n)` — 75/25 comfortable/struggle split over a pool | Selection-from-pool is a bank concept. The 75/25 target is still valid but becomes a **generation constraint** in the spec, not a post-hoc filter. | Fold the 75/25 target into `ExerciseGenerationSpec.generation_plan` + `K/T_range`. Keep the heuristic for choosing among validated generated items if over-generated. | Low |
| `packages/practice/src/index.ts` + JSDoc | "authored question bank (validated)… assignment builder from planned actions" | Describes the old model. | Rewrite package purpose; likely split `@copilot/practice` (loop/hint-ladder/submission) vs `@copilot/exercise-gen` (spec + generator + validator). | Low (doc) |
| `packages/practice/src/data/questions.json` (7) + `questions.ai-draft.json` (22) | The authored + AI-draft banks (Q5) | Content stays valuable — becomes the **Reference Problem Library** seed + generator few-shot grounding + golden fixtures. | Move to `packages/reference-library/data/`. `origin` field stays. `QUESTION_BANK_PLAN.md` reframed as "reference library + generator grounding plan". | Low |
| `apps/web/lib/child-scene.ts` | `loadQuestionBank`, `buildAssignmentsForPlan` to build the demo child view | Demo path exercises the bank. | Point the demo at a mock `ExerciseGenerator` (deterministic canned output) so the web demo shows generated worksheets. | Low (demo only) |
| `packages/practice/src/hint-ladder.ts`, `submission.ts`, `offline-queue.ts` | 6-rung hint ladder, submission→evidence, offline queue | **No conflict** — these operate on a `Question` + `Submission` regardless of origin. | Keep. `submissionToEvidence` must also record `generation_spec_id` on the evidence for traceability. | Low |

### 1.2 Domain types

| Location | Conflict | Migration action |
|---|---|---|
| `packages/domain/src/planning.ts` `Question` | `origin: 'authored' \| 'ai_generated'` already exists ✅. `id: string` assumes a stored catalog id. | Add `origin: 'reference'`; make `id` a generated ULID for AI items; add `generationSpecId?`, `variantOf?`. |
| `packages/domain/src/planning.ts` `Assignment` | `questionIds: readonly string[]` — points into a catalog. | Add `questions: readonly Question[]` (inline generated content) OR a `generatedExerciseSetId`. Keep `questionIds` deprecated for reference-library items. |
| `packages/domain/src/planning.ts` `LEARNING_ACTION_KINDS` | 9 kinds — maps 1:1 to spec `distribution` buckets ✅ | Keep; these become the `ExerciseGenerationSpec.generation_plan.distribution` keys. |

### 1.3 Docs

| Doc | Line/section | Conflict | Action |
|---|---|---|---|
| `CLAUDE.md` | "authored question bank", "Authored-first, AI sau"; P5 phase note | Old model. | Rewrite: AI-generation-first core loop; reference library role; new services list. |
| `01_PROJECT_UNDERSTANDING.md` | §8.3 core loop "→ Adaptive Practice →"; §8.4 "Personalized Development Curriculum — AI đề xuất" (already close) | Core loop diagram lacks Curriculum Clock / Resolver / Spec / Generator / Validator. | Replace §8.3 with the v1.1 LOCKED core loop verbatim. §1 "NOT a question bank" already correct — reinforce. |
| `06_AI_ORCHESTRATION_PLAN.md` | §2 "Question generation … gán vào assignment"; §4 `generateItems(spec, schema)`; §6 "fallback về ngân hàng câu hỏi authored"; §7 "85–95% ở … question-bank" | Fallback-to-bank and "question-bank" as a routing tier contradict §K ("do not solve cost by reverting to static bank"). | Rewrite: generation pipeline with Spec → batch generate → validate; the FREE fallback is **cached/reused personalized sets + deterministic transforms**, never "static bank as fresh diagnosis". |
| `07_MATH_ENGINE_PLAN.md` | §14 action set; "Adaptive Practice Ladder"; §10 Learning Prescription | The engine must now emit `ExerciseGenerationSpec`. | Add a section: "Deterministic → ExerciseGenerationSpec". Prescription feeds the spec. |
| `08_GOLDEN_TEST_PLAN.md` | golden question dataset used as a bank? | Datasets stay as **generator grounding + regression fixtures**, not delivery. | Add: generated-exercise validation golden tests; TEST 1–13 from the prompt. |
| `10_IMPLEMENTATION_ROADMAP.md` | P5 "authored trước, AI sau" | Reordered. | Update P5/P6 to generation-first. |
| `11_RISKS_AND_OPEN_QUESTIONS.md` | R7 "Authored-first, AI sau" | Mitigation changes. | R7 mitigation → deterministic Spec + multi-layer validation + selective AI verifier + golden regression. |
| `PENDING_APPROVAL.md` D-03 | "Ngân hàng câu hỏi authored (100–200 câu)" | Reframed. | D-03 → "Reference Problem Library + generator grounding set". |
| `QUESTION_BANK_PLAN.md` | Whole doc | Reframed. | Becomes `REFERENCE_LIBRARY_AND_GROUNDING_PLAN.md`. |

---

## 2. "App only knows the current lesson from parent/teacher update"

| Location | What it does | Conflict | Migration action | Risk |
|---|---|---|---|---|
| `packages/learning-context/src/build.ts` | `buildLearningContext` — `standardPosition` = **whole grade** (`note: 'lịch trình theo tuần chưa được cấu hình'`); `actualTaughtPosition` = taught skills OR recent evidence (effectively latest-source-wins); `conflicts` when disjoint | No calendar model → the app cannot estimate "current lesson" unaided. `actualTaughtPosition` selection is a simple precedence, not the weighted resolver v1.1 §D requires. | **Add** `@copilot/curriculum-clock` (`CurriculumClockService`). **Add** `LearningContextResolver` (may live in `@copilot/learning-context`) that consumes clock estimate + teacher/parent updates + scan/test evidence with reliability × confidence × recency × consistency × repetition. | High — `LearningContext` shape changes; consumed by planning, projections, web, api, revision. |
| `packages/domain/src/context.ts` `LearningContext` | `standardPosition` / `actualTaughtPosition` / `frontier` / `activeSkillIds` / `conflicts` | Missing `expected_context`, `resolved_actual_context`, `source`, `confidence`, `last_verified_at`, `pace_delta`. | Extend `LearningContext`: `expected: {position, source: 'CURRICULUM_TIMELINE', confidence: 'ESTIMATED', asOfDate}` + `resolved: {position, source, confidence, lastVerifiedAt}` + `paceDelta`. Keep `standardPosition`/`actualTaughtPosition` as aliases during migration. | High (type change) |
| `packages/domain/src/context.ts` `TeacherContribution` | append-only context event, `contributedAs`, `taughtSkillIds`, `examRef` | No `source reliability` / `confidence` field on the contribution. | Add `reliability` (teacher > parent) + `confidence` to the contribution / resolver input. | Med |
| `04_DATABASE_MODEL.md` | `teacher_contributions` table; no curriculum-calendar table | No place to store `academic_year`, `school_start_date`, `holidays`, `pace_delta`, resolved context history. | New tables: `curriculum_calendars` (curriculum × grade × year: start date, week map, holidays, pacing), `child_school_enrollment` (child → grade, calendar, section), `learning_context_snapshots` (expected + resolved + source + confidence + pace_delta, append-only). | Med |
| `03_SYSTEM_ARCHITECTURE.md` §4 core loop | "evidence → twin → …" — no clock/resolver | Update the core processing loop to the v1.1 diagram. | — |
| `05_API_CONTRACT_PLAN.md` | parent/teacher update endpoints; no "confirm current lesson" or "context source" surfaced | Parent needs to see "app thinks you're on Lesson 6 (estimated) — confirm?". | Add `GET /children/:id/learning-context` returning expected+resolved+source+confidence; `POST …/confirm-lesson`. |
| `09_FRONTEND_ARCHITECTURE.md` + `apps/web` LearningContextCard | Shows "Con đang học X · Giáo viên xác nhận" | Must show estimated vs confirmed + a confirm affordance. | Projection + card update. |
| `packages/revision/src/*` `inferExamScope` | infers exam scope from context + twin | Should also use the clock (exam near a semester boundary). | Feed clock estimate into `inferExamScope`. | Low |

---

## 3. "AI decides difficulty / curriculum when generating"

| Location | Conflict | Migration action | Risk |
|---|---|---|---|
| `06_AI_ORCHESTRATION_PLAN.md` §3 classification schema | `candidate_skill_ids`, K/T — AI *proposes*; deterministic decides. Already correct for classification. **But there is no generation contract** where the deterministic layer fixes the spec first. | Add `ExerciseGenerationSpec` (domain type + Zod schema in `@copilot/schemas`). Add `14_AI_EXERCISE_GENERATION_ARCHITECTURE.md`. | Med |
| `packages/ai` | No `ExerciseGenerator`, no generation schema, no validator | Add `@copilot/exercise-gen`: `buildExerciseGenerationSpec` (deterministic, in `@copilot/planning` or a new package) + `ExerciseGenerator` (AI, in `@copilot/ai`) + `GeneratedExerciseValidator` (deterministic, in `@copilot/exercise-gen`). | High (new surface) |
| `packages/gap-engine/src/error-signature.ts` `classifyErrorSignature` | AI proposes `error_signature` → deterministic map. **No conflict** — this is the right pattern; the generator must follow it. | Keep; reuse as the model for the generation validation boundary. | — |
| Non-negotiables (routing yaml) | "AI cannot invent production skill_id"; "low-confidence cannot silently update Twin" | Partly enforced (`classifyErrorSignature` maps only known signatures; `SIGNATURE_TO_GAP`). Generation path has **no such guard yet**. | `GeneratedExerciseValidator` MUST reject any `skill_id` / `problem_type_id` not in the KB, any K/T outside the spec range, any item requiring un-taught prerequisite knowledge. | High (correctness) |

---

## 4. "Model routing based on plan" + "one AI call per question" + "cost = token/user" + "hard-coded provider/model/pricing"

| Location | What it does | Conflict | Migration action | Risk |
|---|---|---|---|---|
| `packages/ai/src/routing.ts` | `ROUTING_MATRIX`, `resolveRoute(op, ctx, {advancedModelChosen})`; `RouteContext` has no `plan` field but `AI_OPERATIONS` is generic | Close to v1.1 already (Luna-first, advanced benchmark-gated, Q2 fallback). **Gaps:** operation taxonomy doesn't match v1.1 (`WORKSHEET_BATCH_GENERATION`, `NEXT_BEST_QUESTION`, …); no explicit "plan never selects model" assertion in code; `escalated_from` not tracked. | Rename/extend `AI_OPERATIONS` to v1.1 taxonomy. Add `AIModelRouter` class wrapping `resolveRoute` + advanced-candidate gate (K4/K5, T4/T5, HSG, proof, nonlinear, verifier-fail, low-confidence). Assert plan is **not** an input to model choice (only to budget). | Med |
| `packages/ai/src/budget.ts` | `checkBudget({plan, state, estimatedCostVnd, requestedTier})`; `PLAN_COMMERCIALS` (v1.0 numbers); traffic light 3-state via `margin.ts` | **v1.0 numbers**. 2 thresholds not 3. `marginLight` = GREEN/YELLOW/RED, no **BLOCKER**. `checkBudget` conflates "downgrade advanced" with "at ceiling". | Update `PLAN_COMMERCIALS` to v1.1 (target / operational ceiling / absolute boundary). Add `AIBudgetGuardrail` with 4 states (GREEN/YELLOW/RED/BLOCKER). RED = anomaly/abuse controls, NOT quality reduction. BLOCKER = projected economics cross the 50% boundary → needs approval. | High (economics) |
| `packages/ai/src/margin.ts` | `PLAN_COMMERCIALS` (`aiTargetVnd`, `aiCeilingVnd`); `contributionMargin`; `marginTable`; `marginLight` 3-state | v1.0 numbers; `margin.test.ts` asserts BASIC contribution **90,750** (6K target). | v1.1: BASIC 88,750 / PLUS 126,750 / PRO 188,750 at target; margins 52.51 / 55.35 / 57.37%. At operational ceiling 51.33 / 52.29 / 53.72%. Add `absoluteBoundaryVnd`. Rewrite `margin.test.ts` to v1.1 `pricing_guardrails_v1.1.yaml` numbers. | Med (tests) |
| `packages/ai/src/pricing.ts` `PricingRegistry` | effective-dated model prices; `DEFAULT_PRICE_TABLE` seeded from v1.0 §2 | **No conflict** — pattern is right. `price_config_effective_date` must be surfaced into telemetry. | Keep. Add `priceConfigEffectiveDate` to the `tokenCostUsd` result / telemetry. | Low |
| `packages/ai/src/usage-event.ts` `AiUsageEvent` | provider, model, tokens, cached, image_count, ocr_pages, cost usd/vnd, latency, confidence, escalation_reason, plan, userRef, childRef, requestId | **Missing:** `model_version`, `price_config_effective_date`, `generation_spec_id`, `learning_context_source`, `K_target`, `T_target`, `escalated_from`. Operation type enum is v1.0. | Extend `AiUsageEvent` + `buildUsageEvent`. Rename to (or wrap as) `AICostLedger`. Update `rollup()` for operation-dimension forecasting. | Med |
| `packages/ai/src/orchestrator.ts` `AiOrchestrator` | `runStructured` — one call, validate, record cost. No batch concept. | Needs a `runBatchGeneration` path (1 call → N items) + per-operation cost attribution. | Add batch method; keep `runStructured` for single ops. | Med |
| `migrations/1756771200000_ai_cost_telemetry.js` | `ai_pricing_registry`, `ai_usage_events`, `plan_budget_ledger` | `ai_usage_events` missing the new columns; `plan_budget_ledger` is a per-user rollup only — v1.1 wants operation-dimension forecast. | New migration: add columns to `ai_usage_events`; add `ai_operation_cost_rollup` (plan × operation × grade × K/T × period). Keep old columns. | Med |
| `08_GOLDEN_TEST_PLAN.md` + `packages/testing/src/benchmark/*` | benchmark harness built (v1.0) | v1.1 §13 keeps the same kit + adds "projected AI COGS by plan under AI-generation-first usage" as a required output. | Extend the benchmark decision template; add operation-cost forecast. Benchmark still needs real images (D-07, deferred). | Low |
| `PRICING_AND_COST_GUARDRAILS.md` | authoritative doc, v1.0 numbers + 2 thresholds | Superseded. | Replace with `15_AI_COST_AND_MODEL_ROUTING.md` (v1.1); leave a stub pointer. |
| `CLAUDE.md` "AI cost invariants" | v1.0 numbers, "hard ceiling", 85% Luna-or-cheaper | Update to v1.1 (3 thresholds, 4 states, operation forecasting, plan≠model). | — |

---

## 5. Golden test impact (no expected outputs edited — §O)

| Dataset | Impact | Action |
|---|---|---|
| Golden **Question** (120) | Was a resolver/mapping gate. Still valid as **generator grounding + skill-id validation gate**. | Keep tests. Add: every generated question's `skill_id` must resolve (same gate). |
| Golden **Error** (360) | `classifyErrorSignature` regression. Unaffected by generation change. | Keep. |
| Golden **Twin & Planner** (48) | Pipeline `Evidence → Twin → Gap → Readiness → Mix → DailyPlan`. The **planner now also emits an `ExerciseGenerationSpec`** — add spec assertions (TEST 4: two profiles at same lesson → different spec). | Extend, don't edit expected. |
| Golden **E2E Family Journey** (24) | Journeys assume parent/teacher context. **TEST 1** (no updates → estimated context) is new. Checkpoints inherit twin state — unaffected. | Add `curriculum-clock.test.ts` + `context-resolver.test.ts`; add TEST 1–3 to the E2E suite. |
| **New** | `exercise-generation.test.ts` (spec determinism, TEST 4–6), `generated-validator.test.ts` (TEST 8), `model-router.test.ts` (TEST 7, 10, 11), `budget-guardrail.test.ts` (TEST 12, 13), `curriculum-clock.test.ts` (TEST 1–3). | Add. |
| Existing | `packages/ai/src/{margin,budget,routing,usage-event}.test.ts` reference v1.0 numbers/shape. | Rewrite to v1.1 (this is a spec-number change, not a golden edit). |
| Existing | `packages/practice/src/practice.test.ts`, `packages/testing/src/pipeline.test.ts` import `loadQuestionBank` / `buildAssignment`. | Rework to the generation path (mock generator). |

---

## 6. Code at risk of becoming obsolete

| Item | Status after migration |
|---|---|
| `packages/practice/src/assignment.ts` `buildAssignment` (bank filter) | **Replaced** by spec → generator → validator. Old code deleted after the new path passes golden. |
| `packages/practice/src/stretch-zone.ts` `selectStretchSet` | **Demoted** — from "the selector" to "tie-breaker among validated generated items". Logic kept. |
| `packages/practice/src/data/questions*.json` as a *bank* | **Repurposed** to reference library / grounding. Content survives. |
| `buildAssignmentsForPlan` | **Replaced** by `generateWorksheet(plan)` (batch). |
| `PRICING_AND_COST_GUARDRAILS.md` | **Superseded** by `15_AI_COST_AND_MODEL_ROUTING.md`. |
| `QUESTION_BANK_PLAN.md` | **Superseded** by reference-library plan. |
| `RouteContext.plan` coupling (if any leaks into model choice) | **Removed** — plan → budget only. |
| `marginLight` 3-state | **Replaced** by 4-state `AIBudgetGuardrail`. |
| `AI_OPERATIONS` v1.0 enum | **Replaced** by v1.1 operation taxonomy. |

Nothing is deleted in Phase 1–2. Deletions happen in Phase 3 steps, each gated on the replacement passing golden + new tests.

---

## 7. Open questions for anh (only what cannot be derived)

See the Executive Summary. Everything LOCKED in the v1.1 prompt/spec is treated as decided and is **not** re-asked here.
