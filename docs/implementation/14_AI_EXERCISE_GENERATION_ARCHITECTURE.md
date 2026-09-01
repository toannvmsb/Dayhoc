# 14 — AI Exercise Generation Architecture

> **Authority:** Pricing/AI Cost/Routing **v1.1** §1, §3, §4, §8 (LOCKED —
> `AI_GENERATION_FIRST`). Part of the migration — see
> [12_ARCHITECTURE_MIGRATION_AUDIT.md](12_ARCHITECTURE_MIGRATION_AUDIT.md).
>
> **Implementation status (Group C):**
> - **C1 ✅** — `ExerciseGenerationSpec` + `exerciseGenerationSpecSchema` +
>   deterministic `buildExerciseGenerationSpec`.
> - **C2 ✅** — reference library (repurposed question bank).
> - **C3 ✅** — `GeneratedExerciseValidator` (`@copilot/exercise-gen`).
> - **C3.1 ✅** (hardening, anh 2026-09-01):
>   - **Thinking Level policy** — T range driven by demonstrated thinking level +
>     evidence, then goal + readiness. HSG + `ready` + strong thinking evidence →
>     controlled 2-step stretch, **T4/T5 reachable** (T5 ≠ above-grade knowledge).
>     HSG + weak thinking evidence → **no auto T5**. Strong thinking + school goal
>     → a thinking-challenge slot, different allocation.
>   - **`GeneratedExercise.requiredSkillIds`** (what a solution actually needs) +
>     optional `supportingSkillIds`. Validator checks identity + prereq closure of
>     the *required* set; a weak but unrelated prerequisite no longer blocks.
>   - **Item vs batch outcome** — `ItemValidationOutcome` (per item) vs
>     `BatchDisposition` (`DELIVER | REPAIR | REGENERATE_SLOTS | QUARANTINE`).
>     Contract violations quarantine the whole batch; `deliverable` is true only
>     when every slot is valid AND the count equals `spec.totalQuestions` (**no
>     silent partial worksheet**).
>   - **Curriculum provenance** — no hard-coded version. `KnowledgeBase.provenance`
>     ( `datasetRevision` + deterministic `contentHash` ); the spec records
>     `curriculumRevision` + `curriculumContentHash`.
> - **C4** — Generator contract + Grounding builder + Mock generator + Orchestrator.
> - **C4.1 ✅** (target selection + pipeline hardening, anh 2026-09-01):
>   - **Typed target roles** — `spec.targets.skills: TargetSkill[]` with
>     `role: CURRENT | PREREQUISITE_REPAIR | FRONTIER | THINKING`, `buckets[]`,
>     `knowledgeCeiling`. `targets.skillIds` kept as a deprecated flat alias.
>   - **`selectLearningTargets()`** (`@copilot/planning`) — DETERMINISTIC. Picks
>     CURRENT (resolved lesson), PREREQUISITE_REPAIR (gap/readiness prereqs),
>     FRONTIER (real above-grade skills the Actual Learning Frontier +
>     prerequisite readiness + blocking-gap state support), THINKING (grade-level
>     skills with T4/T5 problem types). AI never selects a frontier skill.
>   - **Structured Actual Learning Frontier** — `DomainFrontierView`
>     (`reachedCurriculumOrigin`, `aboveGrade`, `confidence`, `masteredSkillIds`,
>     `readyNextSkillIds`, `exposureSkillIds`). No magic strings.
>   - **ADVANCED KNOWLEDGE ≠ ADVANCED THINKING** — the `advanced` bucket binds to
>     FRONTIER targets (K4/K5, above-grade); `thinkingChallenge` binds to THINKING
>     targets (T4/T5, grade-level K). Parent goal affects allocation only.
>   - **Bucket→target binding** — `grounding.bucketBindings`; the generator never
>     maps a bucket to an arbitrary skill.
>   - **Validator target-role checks** — `TARGET_ROLE_MISMATCH` (REGEN),
>     `FRONTIER_SKILL_NOT_SELECTED` (BLOCK/QUARANTINE),
>     `REQUIRED_SKILL_OUT_OF_BOUNDS` (BLOCK).
>   - **Cost telemetry** — `AiUsageEvent` / `GenerationOperation` split
>     `estimatedCost*` (forecast, budget only) from `actualCost*` (ledger source
>     of truth; mock → 0). Migration `1757116800000` adds the columns +
>     `generation_specs.target_selector_version`.
>   - **Mock E2E** — numeric / fraction / reasoning-with-rubric answer formats.
> - **C4.2 ✅** (Learning Context / Frontier separation, anh 2026-09-01):
>   - **CURRENT LEARNING CONTEXT ≠ ACTUAL LEARNING FRONTIER.** A synthetic
>     enrichment/HSG node (`C.G7.EXT.0`) can no longer become
>     `resolved.lessonId` — see [13 §5](13_CURRICULUM_CLOCK_AND_CONTEXT_RESOLVER.md).
>     Advanced/HSG evidence still updates the Twin/Frontier/Thinking Profile/Gap
>     state; it never silently redefines the current school lesson.
>   - **`selectLearningTargets()` v2 — NEXT SAFE FRONTIER.** A FRONTIER target is
>     no longer just "the highest demonstrated origin". Candidates are split into
>     `NEXT_SAFE_FRONTIER` (a `readyNextSkillIds` skill — prereqs satisfied, no
>     blocking gap on its path — preferred nearest-origin-first) and
>     `MASTERED_FRONTIER_STRETCH` (an already-mastered above-grade skill). A
>     Grade-7 child who has demonstrated Grade-9 algebra may correctly be routed
>     to a Grade-8 bridge skill first, if that bridge is itself still weak.
>   - **`TargetSkill.selectionReason`** — one of `CURRENT_CURRICULUM |
>     GAP_REPAIR | NEXT_SAFE_FRONTIER | MASTERED_FRONTIER_STRETCH |
>     THINKING_STRETCH | THINKING_ADJACENT_FALLBACK`, plus
>     `selectedCurriculumOrigin`, `selectionConfidence`, and (for FRONTIER
>     targets) `frontierEvidenceOrigin` — the domain's highest DEMONSTRATED
>     origin, which may differ from the selected target's own origin. Every
>     pick is traceable back to WHY.
>   - **No global unlock.** `reachedCurriculumOrigin = 9` never means "all
>     Grade-8/9 skills in the domain are open" — the selector only ever offers
>     skills the prerequisite graph (mastered set + `readyNextSkillIds`) actually
>     supports; an unrelated above-grade skill on the same synthetic node stays
>     rejected.
>   - **Thinking target fallback** — if the current grade-level skill has no
>     authored T4/T5 problem type, a strong-thinking child may get a safe
>     adjacent grade-level skill (same domain, prerequisites satisfied,
>     `THINKING_ADJACENT_FALLBACK`) instead of losing the Thinking Challenge
>     slot; if no such skill exists, no target is fabricated. Above-grade
>     knowledge is never required for T4/T5.
>   - **`selectLearningTargets()` returns a `trace`** — per-domain candidates,
>     rejections (with reasons), and the selected set — for debugging/telemetry.
>     Not persisted on `ExerciseGenerationSpec` (kept `.strict()` and minimal).
>   - `math-data`: `CurriculumNode.nodeType` (`CORE_CURRICULUM | ENRICHMENT |
>     ADVANCED | HSG | DIAGNOSTIC | REFERENCE`, default `CORE_CURRICULUM`) +
>     `isEligibleForCurrentLearningContext(node)`. No string-matching on `"EXT"`.
> - **C5 ✅ — LIVE AI GENERATION IN SHADOW MODE** (anh 2026-09-01) — see
>   [18_LIVE_AI_GENERATION_SHADOW_MODE.md](18_LIVE_AI_GENERATION_SHADOW_MODE.md):
>   - **`AIProviderAdapter` isolation** — `createOpenAiProviderAdapter`
>     (`@copilot/ai/providers/openai-adapter.ts`) is the ONLY OpenAI-aware file;
>     `LunaExerciseGenerator` (`@copilot/exercise-gen/luna-generator.ts`)
>     implements the unchanged C4 `ExerciseGenerator` interface over it.
>   - **`loadAiGenerationConfig()`** — `AI_GENERATION_DEFAULT_PROVIDER /
>     _MODEL / AI_PRICING_CONFIG_VERSION / AI_GENERATION_MODE` from env; no
>     literal model name in planner/validator/target-selector/practice/domain;
>     `resolveLunaApiKey()` reads `OPENAI_API_KEY` fresh and stores it nowhere.
>   - **Both gates stay** — provider `json_object` mode → Zod parse
>     (`generatedExerciseBatchSchema`) → the full `GeneratedExerciseValidator`.
>   - **Education-dumb system prompt** `exercise-generator-prompt.v1`;
>     GENERATION SPEC / REFERENCE DATA are DATA not instructions, delimited from
>     SYSTEM POLICY; `promptVersion` persisted on every op + trace.
>   - **Provider payload = `GenerationGrounding` only** — no childId / name /
>     Twin / evidence / history (asserted).
>   - **`REFERENCE_EXAMPLE_COPY`** reason code — validator now takes the
>     grounding's `referenceExamples` and rejects a verbatim/near copy → REGEN.
>   - **`AnswerVerificationLevel`** — deterministic well-formedness check for
>     numeric/fraction/choice/exact; reasoning → `AI_CROSSCHECK_REQUIRED`.
>     `SecondPassVerifier` port + `wouldRequireVerification` trigger + stub — no
>     live second call wired.
>   - **Actual cost** — `computeActualCost(usage, model, at, PricingRegistry)`,
>     effective-dated; `estimatedCostUsd` stays a forecast; unpriced → `null`,
>     never a pretend actual. `GenerationOperation` gains `promptVersion`,
>     `inputTokens`, `cachedInputTokens`, `outputTokens`, `actualCostVnd`,
>     `priceConfigVersion`, `escalatedFrom`.
>   - **SHADOW mode** — `AiGenerationMode = OFF | SHADOW | LIVE` (default OFF).
>     `ShadowGenerationQueue` port + `InMemoryShadowGenerationQueue`
>     (`setImmediate`, error-isolated). `services/api` `childToday` enqueues a
>     shadow run AFTER returning the legacy child view — the child-visible
>     assignment is byte-identical to the legacy path and a shadow failure never
>     reaches the child. **LIVE is not activated.**
>   - **`PgGenerationStore`** (`@copilot/exercise-gen/pg`) — no new migration
>     (reuses `generation_specs` / `generated_exercise_sets`).
>   - **`aggregateShadowMetrics`** + benchmark harness
>     (`@copilot/testing` `benchmark/luna-generation-benchmark.ts`,
>     `buildBenchmarkSpecs` from the 48 synthetic golden profiles) + provisional
>     `C5_SHADOW_GATES` (review only, never an auto-flip). Live benchmark
>     `describe.skipIf(!RUN_LIVE_AI_BENCHMARK)` + key check.
>   - **No live provider run** (no key in the build environment). Advanced
>     provider stays OPEN_PENDING_BENCHMARK. Practice runtime NOT flipped.
> - **C6–C7 NOT STARTED** — no LIVE mode, no Interactive Adaptive Mode, no NBQ.

---

## 1. The rule

Ordinary personalized practice is **AI-generated to the child's actual state** —
not served from a static bank. The old `loadQuestionBank() → buildAssignment()`
path is retired.

A **Golden / Reference Problem Library** still exists, for exactly and only:
grounding · problem-family examples · generator few-shot · validation reference ·
generator evaluation · regression / golden tests. It is **never** the delivery
mechanism for normal practice (v1.1 §1, §9 — *"Do not solve cost problems by
reverting to a generic static question bank."*).

---

## 2. Pipeline

```
Resolved Learning Context ─┐
Skill / Prereq / ProblemType Graph ─┤
Child Learning Twin ─┤
Knowledge Gaps + Readiness ─┤     buildExerciseGenerationSpec()      ← DETERMINISTIC (no AI)
Thinking Profile ─┤    ───────────────────────────────────────▶  ExerciseGenerationSpec
Actual Learning Frontier ─┤
Parent Goal ─┤
Available Learning Time ─┘
                                          │
                                          ▼
                            AIModelRouter.route(operation, spec)     ← picks Luna / advanced candidate
                                          │
                                          ▼
                   ExerciseGenerator.generate(spec)                  ← AI, content ONLY, inside the spec
                     · WORKSHEET_BATCH_GENERATION  (1 call → N items)
                     · NEXT_BEST_QUESTION          (1 call → 1 item, event-driven)
                                          │
                                          ▼
                   GeneratedExerciseValidator.validate(items, spec)  ← DETERMINISTIC + optional AI verifier
                                          │
                          ┌───────────────┴───────────────┐
                          ▼ pass                          ▼ fail
                    Assignment{questions:[...]}      regenerate (bounded) / fall back to
                          │                          cached personalized set / defer
                          ▼
                    Child Practice → Attempt → Learning Evidence → Twin update → re-plan
```

---

## 3. ExerciseGenerationSpec (LOCKED shape — v1.1 §3)

The deterministic education engine produces this **before any AI call**. AI never
decides what the child should learn.

```yaml
spec_id: egs_01H...                       # ULID, logged in telemetry
child_context:
  school_grade: 7
learning_context:
  curriculum: KET_NOI_TRI_THUC
  current_lesson_id: M7.CURR.G7.6.21
  source: PARENT_UPDATE | TEACHER_UPDATE | SCHOOLWORK_EVIDENCE | CURRICULUM_TIMELINE
  confidence: VERIFIED | STRONG | SUPPORTING | ESTIMATED
target:
  skill_ids: [M7.RATIO.EQUAL_CHAIN, M7.RATIO.PROPORTION]
  problem_types: [equal_ratio, chained_ratio]
child_state:
  mastery: { M7.RATIO.EQUAL_CHAIN: 62, M7.RATIO.PROPORTION: 88 }
  prerequisite_gaps: [{ skill: M4.FRAC.COMMON_DENOM, severity: 0.6, blocking: true }]
  thinking_profile: { algebraic_thinking: T4, number_sense: T3 }
  actual_learning_frontier: { "M7.ALG": above_grade_G9, "M7.GEO": grade_7_standard }
parent_goal: { type: SCHOOL_MASTERY | ADVANCED | HSG | EXAM }
generation_plan:
  total_questions: 10
  distribution:                            # maps 1:1 to LEARNING_ACTION_KINDS
    prerequisite_repair: 2
    current_skill: 3
    variation: 2
    advanced: 2
    thinking_challenge: 1
  K_range: { min: K2, max: K4 }
  T_range: { min: T2, max: T5 }
constraints:
  no_unlearned_required_knowledge: true    # every item solvable with only mastered/current prereqs
  allow_above_grade_reasoning: true        # T can exceed grade; K may not require un-taught knowledge
  require_unique_variants: true
  time_budget_minutes: 25
```

### 3.1 Determinism & personalization (v1.1 §G — LOCKED)

Two children, **same grade + same SGK + same current lesson**, but different
mastery / gaps / thinking profile / frontier / parent goal → **different specs**.
The spec is a pure function of `(resolved context, graphs, twin, gaps, readiness,
thinking profile, frontier, parent goal, available time)`.

School grade is context, not a ceiling. A Grade-7 child may carry an algebra
frontier ~Grade 9, a Grade-7 geometry frontier, strong logic — **and** a Grade
7/8 prerequisite gap. The spec does not collapse this to one grade level; it sets
`K_range` from the gap/frontier per target skill and `T_range` from the thinking
profile + parent goal (Parallel Gap Repair: `prerequisite_repair` bucket ≥ 1
while `advanced` bucket also > 0).

---

## 4. Generation modes (v1.1 §4, prompt §H)

### 4.1 Worksheet Mode — `WORKSHEET_BATCH_GENERATION`

`1 spec → 1 AI generation call → N questions + answers + solutions + metadata`.
**Not** N calls for N questions. This is the daily-practice default and the main
cost lever (§K).

### 4.2 Interactive Adaptive Mode — `NEXT_BEST_QUESTION`

Event-driven. After an attempt, a deterministic policy picks the next move:

| Signal | Move |
|---|---|
| Q1–Q3 correct, fast | `HARDER` — raise K or T within the spec's ceiling |
| wrong, Hint1 fail, Hint2 success | `DIAGNOSTIC` / `GAP_REPAIR` — stop raising difficulty; probe recognition/prerequisite |
| repeated same-type miss | `VARIATION` — same skill, different surface |
| target met | `KEEP` or `THINKING_CHALLENGE` |
| careless pattern | `KEEP` + self-check prompt (no difficulty change) |

Only when the chosen move needs an item not already generated does it call the AI
for **one** Next-Best-Question (still inside a spec derived from the same engine).

---

## 5. What AI may / may not do (v1.1 §8 — LOCKED)

| AI may propose | Deterministic owns |
|---|---|
| question prompts, distractors | production skill IDs |
| worked solutions, hint ladders | prerequisite DAG |
| answer keys | K/T assignment of the *spec* |
| explanations, difficulty *within range* | gap lifecycle, readiness rules |
| error hypotheses | planner constraints, parent goal |
| — | schema + KB validation |

AI **must not**: create a new production `skill_id` or `problem_type_id`; change
the prerequisite graph; raise/lower the curriculum; decide the parent goal;
bypass readiness; exceed the spec's K/T range.

---

## 6. GeneratedExerciseValidator (deterministic gate, before delivery)

Every generated item passes ALL of:

1. **Schema** — Zod parse against `GeneratedExercise` (`@copilot/schemas`).
2. **Known IDs** — `skill_id` ∈ KB; `problem_type_id` ∈ KB (or dropped). A novel ID → **reject the item** (v1.1 §8 non-negotiable).
3. **Range** — `K ∈ spec.K_range`, `T ∈ spec.T_range`.
4. **Prerequisite safety** — with `no_unlearned_required_knowledge`, the item must not require a prerequisite the child hasn't mastered/isn't currently learning (checked against twin + prereq DAG).
5. **Answerability** — the answer key must be checkable against `answerSpec`; for `numeric`/`exact`/`fraction` the validator re-derives or sanity-checks; `reasoning` items need a rubric.
6. **Uniqueness** — no near-duplicate prompts within the batch (`require_unique_variants`).
7. **Hint ladder** — exactly 6 rungs, last = full solution (Math Core §17).
8. **Safety** — no PII, no unsafe content, Vietnamese + SGK notation.

**High-risk / advanced items** (K4–K5, T4–T5, HSG, proof) additionally get an
**AI verifier** pass (independent model, cheap prompt) — v1.1 §8. Verifier
disagreement → regenerate or route the whole spec to the advanced tier.

On batch failure: bounded regeneration (≤ 2 retries, logged with `retry_count`),
then fall back to a **cached previously-generated personalized set** or
deterministic transforms of one (number swaps within the same structure) — never
present a stale set as a fresh AI diagnosis (v1.1 §6 FREE policy).

---

## 7. Domain / schema changes

| Type | Change |
|---|---|
| `@copilot/domain` `Question` | `origin: 'authored' \| 'ai_generated' \| 'reference'`; `id` = ULID for generated; add `generationSpecId?`, `variantOf?` |
| `@copilot/domain` `Assignment` | add `questions: readonly Question[]` (inline generated content); `questionIds` kept for reference-library items only |
| `@copilot/domain` (new) | `ExerciseGenerationSpec`, `GeneratedExercise`, `GenerationMode`, `NextBestMove` |
| `@copilot/schemas` (new) | `exerciseGenerationSpecSchema`, `generatedExerciseSchema`, `generatedBatchSchema` |
| `@copilot/planning` (new) | `buildExerciseGenerationSpec(input)` — deterministic |
| `@copilot/exercise-gen` (new package) | **C3 ✅** `validateGeneratedBatch(batch, spec, kb)` → `BatchValidationResult`. C4/C6: `nextBestMove(policy)`, cached-set fallback |
| `@copilot/ai` (new) | C4: `ExerciseGenerator` (uses `AiOrchestrator.runBatchGeneration`) — **not started** |
| `@copilot/practice` | **C2 ✅** kept hint-ladder / submission / offline-queue; `assignment.ts` now reads `@copilot/reference-library` and is marked LEGACY (C5 deletes it) |
| `@copilot/reference-library` (renamed from question-bank) | **C2 ✅** `loadReferenceLibrary()`, `examplesForSkill()`, `groundingExamplesFor({skillId, problemTypeId?, K?, T?, limit})`, `calibrationRangeFor()` |

---

## 8. Golden tests (no expected outputs edited — prompt §O)

| Test | Asserts |
|---|---|
| `exercise-spec.test.ts` TEST 4 | two golden Twin/Planner profiles at the same lesson → **different `ExerciseGenerationSpec`** |
| `exercise-spec.test.ts` TEST 5 | Grade-7 child at Grade-9 algebra + a prereq gap → spec has `prerequisite_repair ≥ 1` **and** `advanced ≥ 1`, no global downgrade |
| `exercise-spec.test.ts` TEST 6 | 10-question worksheet → single `WORKSHEET_BATCH_GENERATION` operation (mock generator called once) |
| `generated-validator.test.ts` TEST 8 | generator returns `skill_id` not in KB → item rejected, batch still delivers the valid ones |
| `generated-validator.test.ts` TEST 9 | low-confidence extraction feeding the spec → Twin not updated (guard upstream) |
| `next-best.test.ts` TEST 7 | Q1–Q3 fast-correct then Q4 wrong + Hint2 success → next move ∈ {DIAGNOSTIC, GAP_REPAIR}, not HARDER |
| golden Question (120) | still a grounding + skill-id gate; every generated `skill_id` resolves (reuses the mapping gate) |
