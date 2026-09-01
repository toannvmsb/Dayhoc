# 13 — Curriculum Clock & Learning Context Resolver

> **Authority:** Pricing/AI Cost/Routing **v1.1** §2 (LOCKED). Part of the
> AI-Generation-First migration — see [12_ARCHITECTURE_MIGRATION_AUDIT.md](12_ARCHITECTURE_MIGRATION_AUDIT.md).
> **Spec only. Not implemented yet** (Phase 3, [17](17_IMPLEMENTATION_MIGRATION_PLAN.md)).

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

**Guardrails:**
- A single `ESTIMATED` calendar signal never overrides a `VERIFIED`/`STRONG`
  signal that is ≤ 21 days old (v1.1 §2: *"Do not blindly overwrite a recent
  verified context with a calendar estimate."*).
- If the top two candidates are within 15% score and from different sources → emit
  a `conflict` (surfaced to the parent as *"xác nhận giúp: Bài 6 hay Bài 7?"*),
  and provisionally take the more advanced lesson (safer for the planner —
  prerequisites are checked downstream anyway).

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

## 4. Pace learning (`pace_delta`)

If **repeated** observed evidence consistently lands ahead of / behind the clock
estimate, the class is pacing off the mean.

```
observations = [(evidence.at, clock.lesson_at(evidence.at), resolved.lesson_at(evidence.at))]
lag_weeks(o)  = lessonIndex(o.resolved) − lessonIndex(o.expected)   # in "lessons"
```

After ≥ 3 observations spanning ≥ 3 weeks, all with the same sign and |lag| ≥ 1:

```
pace_delta ← clamp(mean(lag_weeks) / effective_weeks_elapsed, −0.35, +0.35)
```

Stored on `learning_context_snapshots` and fed back into the clock. **Never**
destroys verified history — it only shifts future *estimates*.

Example (v1.1 §2): timeline says Bài 6, three homework scans over 3 weeks show
Bài 8 / Bài 9 / Bài 10 → class is ~2 lessons ahead → `pace_delta ≈ +0.2` → next
week's estimate moves forward.

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
