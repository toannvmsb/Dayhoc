# 13 — Curriculum Clock & Learning Context Resolver

> **Authority:** Pricing/AI Cost/Routing **v1.1** §2 (LOCKED). Part of the
> AI-Generation-First migration — see [12_ARCHITECTURE_MIGRATION_AUDIT.md](12_ARCHITECTURE_MIGRATION_AUDIT.md).
> **✅ IMPLEMENTED (2026-09-01, Group B1+B2+B3 of [17](17_IMPLEMENTATION_MIGRATION_PLAN.md)).**
> Code: `@copilot/curriculum-clock`, `@copilot/learning-context`
> (`resolveLearningContext`), `packages/math-data/data/calendars/`. Runtime path is
> dark until a child has `enrollment` + a `VERIFIED` calendar. Deviations from the
> original spec, all tightening it:
> - **`expectedWindow`** — the clock returns a *range* `{fromLessonId, toLessonId,
>   widthLessons, lessonIds}`, never a single "actual" lesson. Width grows early in
>   the year and just after a holiday. `primaryLessonId` + `alsoPlausibleLessonIds`
>   are for display ordering only.
> - **Guardrails A–F** (§3.2) are deterministic and override the numeric score;
>   the score alone is never the decision.
> - **Calendars carry provenance metadata** (`meta:` block — `calendar_id`,
>   `curriculum_id`, `grade`, `academic_year`, `version`, `status:
>   PROVISIONAL|VERIFIED`, `effective_from/to`, `source`, `region`,
>   `school_override_id`) + `pace_uncertainty_lessons`. A new school year is a new
>   calendar file — no service-logic change.
> - **`confirm-lesson` is append-only** — writes a `LessonConfirmationEvent` that
>   flows through the resolver; it never overwrites context history.
> - **Pace policy (§4) LOCKED + implemented** (`pace.ts` `evaluatePace`): ≥3 obs →
>   hypothesis; ≥5 obs over ≥2 school weeks → LOW-confidence auto-apply; bounded;
>   decays on stale/conflicting evidence; an applied pace shifts only the FUTURE
>   estimate, never `resolved` confidence.
> - Functional demo output: [`B3_DEMO_OUTPUT.md`](B3_DEMO_OUTPUT.md).
> - **§5 — C4.2 hardening (2026-09-01): Context ≠ Frontier.** The resolved
>   current lesson MUST be a node a school class actually teaches. Every
>   `curriculum` node now carries `nodeType` (`CORE_CURRICULUM | ENRICHMENT |
>   ADVANCED | HSG | DIAGNOSTIC | REFERENCE`, default `CORE_CURRICULUM`) and
>   `@copilot/math-data` exports `isEligibleForCurrentLearningContext(node)` —
>   never a string match on `"EXT"`. `resolveLearningContext` filters EVERY
>   signal source (lesson confirmations, teacher/parent contributions, observed
>   evidence) through this eligibility check before it can become
>   `resolved.lessonId` — so a parent/teacher cannot even *confirm* a synthetic
>   HSG/enrichment node as "the current lesson". Advanced/HSG evidence still
>   flows to the Twin/gap engine/frontier unchanged (see doc 14 C4.2) — it is
>   simply never a resolver signal. Required tests: `resolver.test.ts` +
>   `packages/testing/src/golden/context-frontier-separation.test.ts`.

---

## 1. Why

The app must work **even when neither parent nor teacher ever tells it what the
class is studying**. Today `buildLearningContext` sets `standardPosition` to the
whole grade with the note *"lịch trình theo tuần chưa được cấu hình"* — i.e. it
has no idea where in the SGK the child is. v1.1 fixes that with two deterministic
services.

```
academic calendar ─▶ CurriculumClockService ─▶ expected_context (ESTIMATED)
                                                     │
teacher update ─┐                                    ▼
parent update  ─┤                          LearningContextResolver ─▶ resolved_actual_context
homework scan  ─┤                                    ▲                 + source + confidence
notebook scan  ─┤                                    │                 + last_verified_at
test / exam    ─┤────────── observed evidence ───────┘                 + pace_delta
teacher msg    ─┘
```

Neither service is AI. Both are pure functions over their inputs.

---

## 2. CurriculumClockService

`CurriculumClockService.positionFor(child, date)` → estimate of where in the SGK
the child's class *should* be.

### 2.1 Inputs

| Input | Source |
|---|---|
| curriculum / textbook | `child_school_enrollment.curriculum` (e.g. `KET_NOI_TRI_THUC`) |
| school grade | `child_profiles.school_grade` |
| academic year | `curriculum_calendars.academic_year` (e.g. `2026-2027`) |
| school start date | `curriculum_calendars.school_start_date` |
| semester boundaries | `curriculum_calendars.semesters[]` |
| holidays / breaks | `curriculum_calendars.holidays[]` (Tết, hè, nghỉ lễ) |
| expected pacing | `curriculum_calendars.pacing` — lessons/week per chapter, from the SGK phân phối chương trình |
| pace_delta | `learning_context_snapshots.pace_delta` — learned adjustment (see §4) |

### 2.2 Algorithm (deterministic)

1. `effectiveWeek = businessWeeksBetween(school_start_date, date) − holidayWeeks`
2. Walk the pacing table (chapter → lessons, lessons/week) to map `effectiveWeek`
   → `(chapter, lesson_number, lesson_id)`.
3. Apply `pace_delta`: `adjustedWeek = effectiveWeek × (1 + pace_delta)`.
4. Emit a **window**, not a point: `{primary_lesson_id, also_plausible: [prev, next]}`
   — a class is rarely exactly on the mean.

### 2.3 Output

```yaml
expected_context:
  curriculum: KET_NOI_TRI_THUC
  grade: 7
  chapter_id: 6
  primary_lesson_id: M7.CURR.G7.6.21     # Bài 21 — dãy tỉ số bằng nhau
  also_plausible_lesson_ids: [M7.CURR.G7.6.20, M7.CURR.G7.6.22]
  source: CURRICULUM_TIMELINE
  confidence: ESTIMATED
  as_of_date: 2026-11-14
  effective_school_week: 11
  pace_delta_applied: 0.0
```

**`confidence: ESTIMATED` is never treated as verified truth.** It is a baseline
the resolver and the planner discount accordingly.

### 2.4 Data (new)

`curriculum_calendars` is authored reference data (like the skill graph), one row
per `(curriculum, grade, academic_year)`. Seed from the SGK official phân phối
chương trình. Lives in `packages/math-data/data/calendars/` → built into the KB.

---

## 3. LearningContextResolver

`LearningContextResolver.resolve({ clock, contributions, evidence, asOf })` →
the single **resolved actual learning context**, plus the audit trail.

### 3.1 Signals & reliability

| Signal | Base reliability | Notes |
|---|---:|---|
| Teacher update (`contributedAs: 'teacher'`) | 0.95 | strongest direct statement of what's taught |
| Verified test / exam scope | 0.9 | proctored |
| Parent update (`contributedAs: 'parent'`) | 0.75 | reliable but second-hand |
| Homework scan | 0.7 | shows what was assigned |
| Notebook scan | 0.65 | shows what was covered in class |
| Teacher message scan | 0.6 | informal |
| App practice evidence | 0.5 | shows what the child *practised*, not necessarily the class lesson |
| Curriculum Clock estimate | 0.35 | calendar baseline |

### 3.2 Resolution (NOT "latest record wins" — v1.1 §D)

For each candidate lesson `L` referenced by any signal in the recency window:

```
score(L) = Σ over signals s pointing at L:
             reliability(s)
           × confidenceWeight(s.confidence)        # VERIFIED 1.0 / STRONG .8 / SUPPORTING .6 / ESTIMATED .4
           × recencyDecay(asOf − s.at)             # half-life ~14 days
           × consistencyBonus(s, otherSignals)     # ×1.15 if ≥2 independent signals agree
           × repetitionBonus(count of s-type)      # ×(1 + 0.1·min(n−1, 3))
```

`resolved_lesson = argmax score(L)`.

**Guardrails (deterministic — `guardrailApplied` names the one that fired; the score alone is never the decision):**

| # | Rule | Implementation |
|---|---|---|
| **A** | A recent VERIFIED context is never overridden by `CURRICULUM_TIMELINE`, nor by a top candidate whose signals are *all* the weakest (ESTIMATED) tier. | `recentVerified` (≤21d) wins when the argmax lesson `chosenIsWeak && !chosenHasVerified` → `A_recent_verified_not_overridden_by_timeline` / `A_recent_verified_beats_low_confidence_majority` |
| **B** | Repeated supporting evidence raises the *score*, never the confidence *tier*. | resolved confidence capped at `max(effConf)` of the chosen lesson's signals; `repetitionBonus` only multiplies score |
| **C** | ≥3 consistent SUPPORTING (non-confirmation) signals → promote SUPPORTING→STRONG (one tier only) **and** emit a `paceDeltaHypothesis` (not applied). | `supportingHere.length >= 3`; `computePaceHypothesis` needs ≥3 recent (≤28d) homework/notebook/test obs, all same sign, value clamped ±0.35 |
| **D** | Conflicting VERIFIED signals on *different* lessons → `conflict` state + deterministic policy (most-recent VERIFIED wins), never a silent numeric pick. | `verifiedByLesson.size >= 2` → `D_conflicting_verified_most_recent_wins`, others → `conflictLessonIds` |
| **E** | A VERIFIED signal older than 35 days is "stale" — downgraded to STRONG for scoring, but kept in history. | `effConf(s)` downgrades; the raw signal stays in `signals[]` |
| **F** | Human confirmation (`TEACHER_UPDATE`/`PARENT_UPDATE`, `isConfirmation: true`) and observed schoolwork (`SCHOOLWORK_EVIDENCE`) are distinct source types. | `Signal.isConfirmation`; a teacher contribution is VERIFIED, a parent contribution STRONG |

Plus the original soft-conflict rule: top two candidates within 15% score from
disjoint sources → `soft_conflict_provisional_pick_more_advanced` (surfaced to the
parent; planner checks prerequisites downstream anyway).

**Grade scope:** the "current class lesson" is a lesson of the child's *own*
grade. Cross-grade remediation work still feeds the twin / gap engine but does not
move the resolved context (`inGrade` filter on `gradeContext`).

### 3.3 Output — `LearningContext` (extended)

```yaml
expected:                       # from the clock
  position: { chapter_id, lesson_id, also_plausible: [...] }
  source: CURRICULUM_TIMELINE
  confidence: ESTIMATED
  as_of_date: ...
resolved:                       # the answer the planner uses
  position: { chapter_id, lesson_id, active_skill_ids: [...] }
  source: TEACHER_UPDATE | PARENT_UPDATE | SCHOOLWORK_EVIDENCE | CURRICULUM_TIMELINE
  confidence: VERIFIED | STRONG | SUPPORTING | ESTIMATED
  last_verified_at: ...          # timestamp of the strongest confirming signal (null if only estimate)
pace_delta: 0.0                  # see §4
frontier: [...]                  # unchanged — per-domain, never a global grade
active_skill_ids: [...]          # unchanged
conflicts: [...]                 # unchanged shape, now resolver-driven
teacher_participated: bool       # unchanged
```

Backward compatibility during migration: keep `standardPosition` = `expected.position`
and `actualTaughtPosition` = `resolved.position` as computed aliases so existing
consumers don't break in one step.

---

## 4. Pace policy (`pace_delta`) — LOCKED 2026-09-01

Implemented in `packages/learning-context/src/pace.ts` (`evaluatePace`). Two ideas
are kept **strictly separate**:

| | Who decides | What it is |
|---|---|---|
| **confirmed current learning context** | parent / teacher | "we are on Bài X" — a `LessonConfirmationEvent`, goes through the resolver |
| **system-inferred curriculum pace** | the system | the class is drifting ahead/behind the calendar mean, learned from observed schoolwork |

The parent is **never** asked to understand or confirm a numeric `pace_delta`.

### Observations

```
POSITION_SOURCES = { school_homework, notebook_scan, school_test, school_exam }
obs        = evidence with skillId, source ∈ POSITION_SOURCES, ≤28 days old,
             whose lesson is in the grade's teaching order
lag(o)     = lessonIndex(o.lesson) − lessonIndex(expected.lesson)   # in "lessons", vs the UNADJUSTED calendar
```

### Thresholds

| observations | span | action |
|---|---|---|
| 1–2 consistent | — | **no adjustment** |
| ≥3 consistent, same sign, \|lag\|≥1 | any | `paceDeltaHypothesis` — surfaced, **not applied** |
| ≥5 consistent | ≥2 distinct school weeks | system **auto-applies a LOW-confidence `pace_delta`** |
| ≥3 consistent **+** a recent (≤28d) lesson confirmation ≥2 lessons off in the same direction | ≥2 weeks | auto-apply floor drops to 3 (confirmation recalibrates faster) |
| conflicting direction / all stale | — | **decays**: pure recompute over current evidence returns 0 |

```
pace_delta ← clamp(mean(lag) / max(4, expectedIndex), −0.35, +0.35)   # hypothesis
auto value ← clamp(hypothesis, −0.25, +0.25)                          # tighter bound for auto-apply
```

Decay is automatic: `evaluatePace` is pure over the *current* evidence, so when
observations age out of the 28-day window or stop agreeing, the value recomputes
toward 0 on the next cycle.

### Application (two-pass, in the orchestrator)

```
base      = clock.positionFor(child, asOf)                      # pace_delta = 0
pace      = evaluatePace({ expected: base, evidence, confirmations, asOf })
applied   = externalOverride ?? (pace.autoApply.applied ? pace.autoApply.value : 0)
effective = applied ≠ 0 ? clock.positionFor(child, asOf, { paceDeltaOverride: applied }) : base
context   = buildLearningContext({ expectedContext: effective, appliedPaceDelta: applied, paceEvaluation: pace, … })
```

The hypothesis is always computed against the **unadjusted** calendar so it keeps
reading "the class is ~N lessons ahead" even after a pace has been applied.

### CRITICAL invariant

An applied `pace_delta` **only shifts the FUTURE `expected` context / window**. It
**never** turns an observed lesson into `VERIFIED` actual context — `resolved`
still carries only the confidence its evidence earns (homework scans → `SUPPORTING`
at best). Tests: `pace.test.ts`, `b3-context-demo.test.ts` ("CRITICAL: an
auto-applied paceDelta never becomes VERIFIED actual context").

Example: calendar says Bài 22, five homework scans over 4 weeks land on Bài 25–27
→ `pace_delta ≈ +0.2` auto-applied (LOW) → next week's *estimate* moves to
chapter 7; `resolved` stays `SCHOOLWORK_EVIDENCE / SUPPORTING`.

---

## 5. Database (new — detail in [04](04_DATABASE_MODEL.md) update)

```
curriculum_calendars(id, curriculum, grade, academic_year,
  school_start_date, semesters jsonb, holidays jsonb, pacing jsonb,
  source, updated_at)                                     -- authored reference data

child_school_enrollment(child_id PK, curriculum, grade, academic_year,
  calendar_id FK, section_label, joined_on)

learning_context_snapshots(id, child_id, computed_at,     -- ⊕ append-only
  expected jsonb, resolved jsonb, pace_delta numeric,
  strongest_signal_at, strongest_signal_source)
```

`learning_context_snapshots` is append-only (like evidence) so the resolver is a
replayable projection.

---

## 6. Acceptance tests (from v1.1 §14 + prompt §P)

| # | Scenario | Expected |
|---|---|---|
| TEST 1 | New Grade 4 child, no parent/teacher update | `resolve()` returns `resolved.position` from the clock, `source: CURRICULUM_TIMELINE`, `confidence: ESTIMATED`. Planner still produces a worksheet. |
| TEST 2 | Clock = Lesson X; parent verified update = Lesson X+1 | `resolved.position` = X+1, `source: PARENT_UPDATE`, `confidence ≥ STRONG`. |
| TEST 3 | Clock = X; 3+ homework scans over 3+ weeks show X+2 | `pace_delta > 0`; next estimate moves forward; **verified history untouched** (snapshots preserved). |
| — | Estimate must not overwrite a 5-day-old verified context | resolver keeps the verified lesson. |
| — | Resolver is a pure replay of its inputs (idempotent) | same inputs → identical output. |
