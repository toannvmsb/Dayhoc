# 20 — School / Academic Year / Classroom / Subject / Enrollment Model

> **Authority:** locked spec §3, §4, §8, §9, §15. Companion: [19](19_IDENTITY_FAMILY_MODEL.md),
> [21](21_LEARNING_RELATIONSHIP_PERMISSION_MODEL.md), [24](24_ACADEMIC_PROGRESSION_ENGINE.md).
> **Status:** SPEC ONLY.

---

## 0. Locked invariants

| # | Invariant |
|---|---|
| E-1 | A School is **not** identified by name. `(name, address)` distinct → distinct `school_id`. |
| E-2 | **Academic Year is first-class.** A classroom belongs to exactly one academic year. `7C0 / 2026-2027` and `8C0 / 2027-2028` are **different `classroom_id`s**. |
| E-3 | **Never overwrite historical enrollment.** A school/class/year change creates a NEW enrollment row; the old one moves to a terminal status. |
| E-4 | **Class membership ≠ Learning Twin sharing** (see doc 21). A privacy mode is chosen per class enrollment. |
| E-5 | School/Class/Teacher data is **Learning Context evidence**, routed through the Resolver with provenance — never absolute truth (preserve doc 13 architecture). |
| E-6 | Grade progression and Class progression are **separate**. Grade +1 may be a strong system proposal; class name (`7C0 → 8C0`) is only a suggestion. Grade 5→6 and Grade 9→10 require school confirmation. |

---

## 1. Current-state audit

| Concept | Today | Gap |
|---|---|---|
| School | **none** — `child_profiles.school_context jsonb` free-form + `child_school_enrollment.section_label text` | ADD `schools` |
| Academic year | `child_school_enrollment.academic_year text` (e.g. `2026-2027`); `curriculum_calendars.academic_year` | ADD `academic_years` (first-class) |
| Classroom | **none** — `child_school_enrollment.section_label` / `teacher_invites.class_ref` are free text | ADD `classrooms` (+ `class_cohorts` optional) |
| Subject | **none** — Math implicit via KB + `gradeContext` | ADD `subjects` |
| Student school enrollment | `child_school_enrollment(child_id **PK**, curriculum_id, grade, academic_year, calendar_id?, section_label, joined_on)` — **1 row/child, overwritten on change** | REPLACE with `student_school_enrollments` (history) |
| Student class enrollment | **none** | ADD `student_class_enrollments` |
| Enrollment transitions | **none** | ADD `enrollment_transitions` |
| Teacher ↔ school/class | `teacher_invites.class_ref` (text) only | ADD `teacher_school_memberships`, `teacher_class_assignments` |
| Curriculum Clock input | `CurriculumClockService.positionFor({ curriculum, grade, academicYear, calendarId? })` reads the single enrollment | EXTEND: resolve the ACTIVE `student_school_enrollments` row as-of the request date (doc 24 §5) |

---

## 2. Education directory

### 2.1 `schools`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `official_name` | text NOT NULL | |
| `short_name` | text nullable | |
| `school_type` | text | `PRIMARY | LOWER_SECONDARY | UPPER_SECONDARY | K12 | OTHER` |
| `official_school_code` | text nullable UNIQUE-when-present | MOET code |
| `province`, `district`, `ward` | text | |
| `address` | text | |
| `latitude`, `longitude` | numeric nullable | |
| `verification_status` | text | `UNVERIFIED | COMMUNITY_VERIFIED | SYSTEM_VERIFIED` |
| `created_by` | uuid → users | |
| `created_at` | timestamptz | |
| unique | `(official_name, province, district, ward, address)` — soft de-dup key (E-1) | |

**De-dup:** `POST /schools/propose` first runs a fuzzy match on `(name, province,
district)` and returns candidates; the user picks one or confirms "create new".
Two identical names at different addresses stay distinct rows.

### 2.2 `academic_years`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `label` | text UNIQUE | `2026-2027` |
| `start_date`, `end_date` | date | |
| `region` | text nullable | MOET dates vary slightly by province |
| `status` | text | `PROVISIONAL | ACTIVE | CLOSED` |

Seeded from MOET typical dates (same source as `curriculum_calendars`).

### 2.3 `subjects`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text UNIQUE | `MATH | VIETNAMESE | ENGLISH | SCIENCE | …` |
| `name` | text | |
| `status` | text | `ACTIVE | PLANNED` — MVP: `MATH` ACTIVE, rest PLANNED |

Subject is threaded through: teacher permissions, teacher contributions,
learning context, assignments, evidence (doc 21 §9). **MVP behaviour:** every
existing Math row is treated as `subject = MATH`; a `subject_id` column is added
(nullable, backfilled to MATH) so nothing breaks.

### 2.4 `classrooms`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `school_id` | uuid → schools | |
| `academic_year_id` | uuid → academic_years | (E-2) |
| `grade` | smallint | 1–12 |
| `class_name` | text | `7C0`, `8A2` — display label, **not identity** |
| `display_name` | text nullable | "Lớp 7C0 — Trường THCS …" |
| `cohort_id` | uuid → class_cohorts nullable | |
| `verification_status` | text | `UNVERIFIED | COMMUNITY_VERIFIED | SYSTEM_VERIFIED` |
| `status` | text | `ACTIVE | ARCHIVED` |
| `created_by` | uuid → users | |
| `created_at`, `archived_at` | timestamptz | |
| unique | `(school_id, academic_year_id, grade, class_name)` | |

### 2.5 `class_cohorts` (optional, evaluated → **ADD, low priority**)

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `school_id` | uuid → schools | |
| `cohort_label` | text | "Cohort C0" |
| `created_at` | timestamptz | |

A cohort is a *hint* that a group of students moves together year to year
(`7C0 → 8C0 → 9C0`). It **never** confers identity — classes may split, merge,
rename, swap students. Used only to seed the *suggested* class name in an
`enrollment_transitions` proposal (doc 24). Ship it in I2 but the progression
engine (I6) can also work without it.

---

## 3. Membership: teacher ↔ school / class

### 3.1 `teacher_school_memberships`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `teacher_user_id` | uuid → users (TEACHER role) | |
| `school_id` | uuid → schools | |
| `role` | text | `STAFF | HOMEROOM | SUBJECT | ADMIN` |
| `status` | text | `ACTIVE | ENDED` |
| `verification_status` | text | `SELF_DECLARED | SCHOOL_VERIFIED` |
| `valid_from`, `valid_until` | date | |
| `created_at` | timestamptz | |

### 3.2 `teacher_class_assignments`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `teacher_user_id` | uuid → users | |
| `classroom_id` | uuid → classrooms | |
| `academic_year_id` | uuid → academic_years | (redundant with classroom, kept for query speed) |
| `subject_id` | uuid → subjects | (E-2 + subject scope) |
| `role` | text | `CLASS_TEACHER | SUBJECT_TEACHER | ASSISTANT` |
| `status` | text | `ACTIVE | ENDED` |
| `verification_status` | text | `SELF_DECLARED | SCHOOL_VERIFIED | PARENT_CONFIRMED` |
| `created_at`, `ended_at` | timestamptz | |

**A teacher class assignment grants NOTHING about any individual child's Twin**
(E-4). It is a fact used for: class-context evidence attribution, teacher
discovery ("your child's class 7C0 has a math teacher who wants to connect"), and
as an *access source* that a parent may later convert into scoped permissions
(doc 21 §6).

---

## 4. Student enrollment (history, never overwritten — E-3)

### 4.1 `student_school_enrollments`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `child_id` | uuid → children | |
| `school_id` | uuid → schools | |
| `academic_year_id` | uuid → academic_years | |
| `grade` | smallint | |
| `curriculum_id` | text | `KET_NOI_TRI_THUC` … (from existing enrollment) |
| `calendar_id` | text nullable | curriculum-clock calendar override |
| `status` | text | `PROPOSED | ACTIVE | COMPLETED | TRANSFERRED | WITHDRAWN | REPEATED` |
| `start_date`, `end_date` | date nullable | |
| `source` | text | `PARENT | TEACHER | SCHOOL | SYSTEM_PROPOSED` |
| `verification_status` | text | `SELF_DECLARED | SCHOOL_VERIFIED` |
| `created_at` | timestamptz | |
| partial unique | `(child_id)` where `status='ACTIVE'` | **at most one ACTIVE school enrollment at a time** |

### 4.2 `student_class_enrollments`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `child_id` | uuid → children | |
| `classroom_id` | uuid → classrooms | |
| `academic_year_id` | uuid → academic_years | |
| `school_enrollment_id` | uuid → student_school_enrollments | the parent school enrollment |
| `privacy_mode` | text NOT NULL default `'PRIVATE_LEARNING'` | `PRIVATE_LEARNING | LINKED_PRIVATE | LINKED_SHARED` (E-4, doc 21 §5) |
| `status` | text | `PROPOSED | ACTIVE | LEFT` |
| `joined_at`, `left_at` | timestamptz | |
| `source` | text | `PARENT | TEACHER | SCHOOL | SYSTEM_SUGGESTED` |
| `verified_by` | uuid → users nullable | |
| `verified_at` | timestamptz nullable | |
| partial unique | `(child_id)` where `status='ACTIVE'` | one ACTIVE class at a time |

### 4.3 State machine (enrollment — spec §13.2)

```
                 ┌───────────────► TRANSFERRED   (school transfer → new PROPOSED/ACTIVE elsewhere)
PROPOSED ──► ACTIVE ─┬───────────► COMPLETED     (end of academic year)
   │                 ├───────────► WITHDRAWN
   │                 └───────────► REPEATED       (grade repeat → new enrollment, same grade)
   └──► (cancelled — row deleted only while still PROPOSED and system-generated)
```

- `ACTIVE → COMPLETED` is the normal year-end transition and is driven by the
  Academic Progression Engine (doc 24).
- `TRANSFERRED` / `WITHDRAWN` / `REPEATED` are guardian- or school-confirmed.
- A `PROPOSED` row that a guardian never confirms simply stays `PROPOSED`
  (surfaced as "confirm your child's class for 2027-2028"); it is not
  auto-promoted.

### 4.4 `enrollment_transitions` — see doc 24.

---

## 5. Curriculum Clock integration (E-5, C4/C5 compatibility)

`CurriculumClockService.positionFor(child, asOf)` today takes
`{ curriculum, grade, academicYear, calendarId? }`. After I3:

```
resolveActiveEnrollment(childId, asOf):
   pick student_school_enrollments WHERE child_id=? AND status='ACTIVE'
       AND (start_date IS NULL OR start_date <= asOf)
   → { curriculum_id, grade, academic_year.label, calendar_id }
   → CurriculumClockService input (unchanged shape)
```

- A `PROPOSED` enrollment is **not** used by the clock — a brand-new / unconfirmed
  child falls back to the existing evidence-only path (doc 13), i.e. exactly the
  C5.2 HC09 "ESTIMATED context" behaviour.
- School/class facts continue to enter the Twin only as `evidence` /
  `lesson_confirmations` / `teacher_learning_contributions` through the Resolver.
  **No new "authoritative" write path** to the Twin is introduced (E-5).

---

## 6. REUSE / EXTEND / ADD / DEPRECATE (school/class/enrollment)

| table | classification |
|---|---|
| `schools` | ADD |
| `academic_years` | ADD |
| `subjects` | ADD |
| `classrooms` | ADD |
| `class_cohorts` | ADD (optional, low priority) |
| `teacher_school_memberships` | ADD |
| `teacher_class_assignments` | ADD |
| `student_school_enrollments` | ADD (replaces `child_school_enrollment`) |
| `student_class_enrollments` | ADD |
| `enrollment_transitions` | ADD (doc 24) |
| `child_school_enrollment` | **DEPRECATE-LATER** — migrate its one row per child into an `ACTIVE student_school_enrollments`; keep a compatibility VIEW named `child_school_enrollment` during I3 so `CurriculumClockService` / api keep working until they're switched. |
| `curriculum_calendars` | REUSE (relate `calendar_id` to `student_school_enrollments`) |

---

## 7. Open questions (school/class/enrollment)

1. **School directory bootstrap.** No MOET dataset in the repo. MVP proposal:
   user-proposed + community-verified only; a later batch import upgrades
   `verification_status`. Confirm acceptable for pilot.
2. **`children.school_grade`** — deprecate now (read from ACTIVE enrollment) or
   keep as a cache for the pilot? Proposal: keep as a nullable cache, updated by a
   trigger/service on enrollment change, remove after I3 is stable.
3. **Cross-year Curriculum Clock** — a child mid-transfer (old `TRANSFERRED`, new
   `PROPOSED`) has no `ACTIVE` enrollment → clock returns null → evidence-only.
   Acceptable, or should the most recent `TRANSFERRED` be used with lowered
   confidence? Proposal: evidence-only (safest).
4. **Subject expansion timing** — add `subject_id` columns now (nullable, MATH
   backfill) so future subjects are non-breaking, but do NOT build non-Math
   curriculum. Confirm.
