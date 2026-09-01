# 14 — AI Exercise Generation Architecture

> **Authority:** Pricing/AI Cost/Routing **v1.1** §1, §3, §4, §8 (LOCKED —
> `AI_GENERATION_FIRST`). Part of the migration — see
> [12_ARCHITECTURE_MIGRATION_AUDIT.md](12_ARCHITECTURE_MIGRATION_AUDIT.md).
>
> **Implementation status (Group C, scope-limited to C1–C3 per anh 2026-09-01):**
> - **C1 ✅** — `ExerciseGenerationSpec` (`@copilot/domain/exercise-gen.ts`),
>   `exerciseGenerationSpecSchema` (`@copilot/schemas`), deterministic
>   `buildExerciseGenerationSpec` (`@copilot/planning/exercise-spec.ts`).
> - **C2 ✅** — reference library (repurposed question bank).
> - **C3 ✅** — `GeneratedExerciseValidator` (`@copilot/exercise-gen`).
> - **C4–C7 NOT STARTED** — no live AI provider, practice runtime NOT flipped,
>   old bank path still in place, no Interactive Adaptive Mode, no NBQ production
>   flow. Awaiting anh's approval of C1–C3.

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
