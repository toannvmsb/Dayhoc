# 24 — Academic Progression Engine

> **Authority:** locked spec §8, §13.2. Companion: [20](20_SCHOOL_CLASS_ENROLLMENT_MODEL.md),
> [25](25_IDENTITY_RELATIONSHIP_API_PLAN.md).
> **Status:** SPEC ONLY — deterministic policy design, no implementation.

---

## 0. Locked invariants

| # | Invariant |
|---|---|
| P-1 | **Never mutate a previous-year enrollment.** Year-end → old enrollment `COMPLETED`, a NEW `PROPOSED` enrollment is created. |
| P-2 | **Grade progression ≠ class progression.** Grade +1 may be a strong system proposal; class name (`7C0 → 8C0`) is only a suggestion. |
| P-3 | Grade **5→6** and **9→10** must **not** assume the same school — require school confirmation or keep the new enrollment `PROPOSED`. |
| P-4 | Support **repeat-grade** (no auto +1), **manual correction**, **graduation**. |
| P-5 | Class / school changes always create new enrollment + a transition record; history stays intact. The Learning Twin keeps the same `child_id` (doc 19 I-3). |

---

## 1. `enrollment_transitions` (ADD)

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `child_id` | uuid → children | |
| `transition_type` | text | `PROMOTION | CLASS_CHANGE | SCHOOL_TRANSFER | REPEAT_GRADE | MANUAL_CORRECTION | GRADUATION` |
| `from_school_id` | uuid → schools | |
| `from_classroom_id` | uuid → classrooms nullable | |
| `from_academic_year_id` | uuid → academic_years | |
| `from_grade` | smallint | |
| `to_school_id` | uuid → schools nullable | null until confirmed for a boundary transfer |
| `to_classroom_id` | uuid → classrooms nullable | |
| `to_academic_year_id` | uuid → academic_years | |
| `to_grade` | smallint | |
| `suggested_class_name` | text nullable | from cohort (doc 20 §2.5) — a suggestion only (P-2) |
| `status` | text | `PROPOSED | CONFIRMED | CANCELLED` |
| `requires_school_confirmation` | boolean NOT NULL | true for grade 5→6, 9→10, school transfer (P-3) |
| `proposed_by` | text | `SYSTEM | PARENT | TEACHER | SCHOOL` |
| `proposed_by_user_id` | uuid → users nullable | |
| `confirmed_by_user_id` | uuid → users nullable | authorised guardian (or school, later) |
| `created_at`, `confirmed_at` | timestamptz | |
| partial unique | `(child_id, to_academic_year_id)` where `status IN ('PROPOSED','CONFIRMED')` | one live transition per target year |

---

## 2. Deterministic policy

Given a child with an `ACTIVE student_school_enrollments` for year `Y`
(`school S`, `grade G`) as the year `Y` closes:

```
determineProposal(child, activeEnrollment, nextYear):
   fromGrade = activeEnrollment.grade
   toGrade   = fromGrade + 1                       # PROMOTION default
   type      = PROMOTION
   toSchool  = activeEnrollment.school_id          # tentative
   requiresSchoolConfirmation = false

   # --- grade-boundary rules (P-3) ---
   if fromGrade == 5 and toGrade == 6:   requiresSchoolConfirmation = true; toSchool = null
   if fromGrade == 9 and toGrade == 10:  requiresSchoolConfirmation = true; toSchool = null
   if fromGrade == 12:                   type = GRADUATION; toGrade = null; toSchool = null

   # --- repeat / correction are never auto-proposed ---
   #   REPEAT_GRADE and MANUAL_CORRECTION are only ever guardian/school initiated.

   # --- class suggestion (P-2) ---
   suggestedClassName =
       if activeEnrollment has a class enrollment whose classroom.cohort_id is set:
           next class_name in that cohort's naming series   (7C0 → 8C0)
       else: null

   return EnrollmentTransition{
       transition_type: type,
       from_*: activeEnrollment,
       to_academic_year: nextYear,
       to_grade: toGrade,
       to_school_id: toSchool,               # may be null → guardian must pick
       to_classroom_id: null,                # never auto — guardian confirms/creates
       suggested_class_name: suggestedClassName,
       status: PROPOSED,
       requires_school_confirmation: requiresSchoolConfirmation,
       proposed_by: SYSTEM,
   }
```

- The proposal is **surfaced, never applied**. The guardian sees:
  "Confirm [child]'s 2027-2028 enrollment — suggested: Grade 8 at [School A],
  class 8C0. [Confirm] [Change school] [Change class] [My child is repeating Grade 7]".
- Class name is always editable; changing `8C0 → 8A2` just edits/creates the
  target `classrooms` row before confirmation.
- For a boundary transition (`to_school_id = null`), `Confirm` is disabled until
  the guardian selects/creates the new school.

---

## 3. Confirmation flow (`POST /children/:id/enrollment-transitions/:tid/confirm`)

```
confirmTransition(tid, guardianUserId, overrides):
   require authorisedGuardian(guardianUserId, child.id)
   require transition.status == PROPOSED
   apply overrides (to_school_id, to_classroom_id / suggested_class_name, to_grade for REPEAT/CORRECTION)
   require to_school_id set  (if requires_school_confirmation)
   in one DB transaction:
      old ACTIVE student_school_enrollments  → status = COMPLETED (or TRANSFERRED / REPEATED)
      old ACTIVE student_class_enrollments   → status = LEFT, left_at = now
      new student_school_enrollments (status = ACTIVE, source = PARENT, start = nextYear.start_date)
      new student_class_enrollments  (status = ACTIVE, privacy_mode = privacy_preferences.default, source = PARENT)
      transition.status = CONFIRMED, confirmed_by_user_id, confirmed_at
      audit_events row  (ENROLLMENT_TRANSITION_CONFIRMED)
   # Learning Twin: unchanged — same child_id, no recompute needed (P-5, doc 19 I-3)
   # Curriculum Clock: next positionFor() call resolves the new ACTIVE enrollment (doc 20 §5)
```

### 3.1 Transition-type effects

| type | old school enrollment → | notes |
|---|---|---|
| `PROMOTION` | `COMPLETED` | grade +1, same or guardian-chosen school |
| `CLASS_CHANGE` | *unchanged* (same year) | only `student_class_enrollments` rotates; no new school enrollment |
| `SCHOOL_TRANSFER` | `TRANSFERRED` | new school enrollment (any time of year); `requires_school_confirmation = true` |
| `REPEAT_GRADE` | `REPEATED` | `to_grade = from_grade`; guardian/school initiated only |
| `MANUAL_CORRECTION` | `WITHDRAWN` + new `ACTIVE` | fixes a data-entry error; guardian initiated; audited with a reason |
| `GRADUATION` | `COMPLETED` | no new enrollment; child profile flagged `graduated` (still keeps `child_id` + Twin for records / alumni) |

---

## 4. Year-end batch (SYSTEM proposer)

A scheduled job (design only — no cron in this phase):

```
onAcademicYearClosing(Y):
   for each child with ACTIVE student_school_enrollments in year Y:
      if no enrollment_transitions row for (child, Y+1):
         create determineProposal(child, enrollment, Y+1)   # status = PROPOSED
      # do NOT touch the ACTIVE enrollment yet — it flips to COMPLETED only on confirm
   notify each guardian: "confirm next year's class"
```

Idempotent (`partial unique (child_id, to_academic_year_id)`). Runs again safely.

---

## 5. Curriculum Clock & C4/C5 compatibility

- `CurriculumClockService` reads **only `ACTIVE`** enrollments (doc 20 §5). A
  child with only a `PROPOSED` next-year enrollment → clock returns null → the
  evidence-only path (doc 13) → exactly the C5.2 **HC09 ESTIMATED** behaviour.
- No change to the generation pipeline: `buildExerciseGenerationSpec` gets its
  `gradeContext` from the ACTIVE enrollment's grade; a mid-transition child with
  no ACTIVE enrollment is handled by the caller passing the last known grade with
  `ESTIMATED` context (conservative — C5.2 §HC08/HC09).
- The Learning Twin, gaps, generation specs and generated sets are **never**
  reset by a transition — they key on `child_id` (P-5).

---

## 6. State machine (enrollment lifecycle — recap of doc 20 §4.3)

```
PROPOSED ──confirm──► ACTIVE ──year-end/confirm──► COMPLETED
    │                   │
 (system-cancel         ├──school transfer──► TRANSFERRED
  only while            ├──guardian──────────► WITHDRAWN
  PROPOSED+SYSTEM)      └──repeat────────────► REPEATED
```

---

## 7. Open questions (progression)

1. **Cohort class-name series** — how is "next class name" derived (`7C0 → 8C0`)?
   Proposal: a `class_cohorts.naming_pattern` (e.g. `{grade}C0`) rendered with the
   new grade; if no pattern, no suggestion. Confirm.
2. **Auto-COMPLETE timing** — flip the old enrollment to `COMPLETED` on the
   guardian's confirm (proposed) vs on `academic_years.end_date` regardless?
   Proposal: on confirm; if never confirmed, the old enrollment stays `ACTIVE`
   into the new year and the clock keeps using the old grade (surfaced as a
   nag). Confirm.
3. **Graduation retention** — keep the `child_id` + Twin indefinitely (alumni /
   returning users) subject to the deletion policy? Confirm.
4. **Teacher-proposed transitions** — a `CLASS_TEACHER` may propose a
   `CLASS_CHANGE` (`proposed_by = TEACHER`); it still needs guardian `Confirm`.
   Confirm this is desired for the pilot or defer to I6+.
