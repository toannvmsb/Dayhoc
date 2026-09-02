# 23 — Database & Migration Plan (Identity / Family / School / Relationship)

> **Authority:** locked spec §10, §11, §17. Companion: [19](19_IDENTITY_FAMILY_MODEL.md)–[22](22_AUTH_AND_WORKSPACE_ARCHITECTURE.md),
> [24](24_ACADEMIC_PROGRESSION_ENGINE.md), [27](27_IDENTITY_MIGRATION_ROADMAP.md).
> **Status:** PLAN ONLY — no migration files written in this phase.

---

## 0. Database decision (LOCKED by spec §10)

- **Primary structured store: PostgreSQL**, preferred managed = **Supabase Postgres**.
- Everything relational lives in Postgres: identity, roles, families, children,
  school/class/year/subject, enrollments, relationships, permissions, consent,
  curriculum context, Twin, gaps, plans, generation specs, generated sets,
  assignments, attempts, evidence, AI cost/telemetry.
- **Object storage** (private, S3-compatible / Supabase Storage) for binaries:
  homework scans, test images, notebook scans, PDFs, teacher attachments.
  Postgres stores **metadata only** — the existing `uploads(id, child_id, kind,
  storage_key, status)` shape is correct; extend with `mime_type`, `hash`,
  `processing_status`, `owner_user_id`. **No binary columns in Postgres.**
- Migration tool: **node-pg-migrate** (existing). Every migration is `up`/`down`
  verified against the portable Postgres before commit (existing practice).
- Append-only ledgers keep the existing `reject_ledger_mutation` trigger pattern.

---

## 1. Current schema (8 migrations) — inventory

```
1756512000000_init                     schema_meta, pgcrypto
1756598400000_evidence_ledger          users, families, parents, teachers, child_profiles,
                                       teacher_invites, ai_inferences, uploads, evidence,
                                       teacher_contributions   (+ append-only triggers)
1756684800000_privacy_foundation       child_credentials, child_quick_access,
                                       child_profiles.deletion_state, consent_records,
                                       ai_provider_registry, data_processing_inventory,
                                       deletion_jobs, rights_requests
1756771200000_ai_cost_telemetry        ai_pricing_registry, ai_usage_events, plan_budget_ledger
1756857600000_ai_cost_v1_1             ai_usage_events cols, ai_operation_cost_rollup, plan_budget_config
1756944000000_curriculum_context       child_school_enrollment, lesson_confirmations,
                                       learning_context_snapshots, curriculum_calendars
1757030400000_generated_exercises      generation_specs, generated_exercise_sets  (append-only)
1757116800000_cost_actuals...          ai_usage_events actual_cost cols, generation_specs.target_selector_version
```

**Not yet migrated (in-memory + DB-model doc only):** twin/skill_states,
problem_type_mastery, thinking_profile, knowledge_gaps, learning_readiness,
actual_learning_frontier, learning_context, learning_prescriptions, daily_plans,
assignments, submissions, assessments, exams, revision_plans, weekly_reports,
notifications.

---

## 2. Migration groups (additive, no big-bang — spec §17)

Each group: **additive schema → domain types → services → API → tests →
compat/rollback → (later) remove legacy assumption.**

### I0 — Current-state audit (no schema)

- Run data checks against the live DB:
  - `SELECT role, count(*) FROM users GROUP BY role;` — any `child`-role rows?
  - `SELECT count(*) FROM child_profiles;` `SELECT count(*) FROM child_school_enrollment;`
  - `SELECT status, count(*) FROM teacher_invites GROUP BY status;`
  - FKs referencing `users` where the domain concept is a child.
- Output: `docs/implementation/I0_AUDIT_RESULTS.md` (a data snapshot, filled when
  a populated DB exists — the pilot DB is currently empty, so I0 is trivially "0
  rows" and the migrations below are green-field-safe).

### I1 — Identity + Family (additive)

New: `user_roles`, `parent_child_relationships`, `student_account_links`,
`family_memberships`.
Alter: `users` (+`auth_user_id text UNIQUE`, `primary_email citext`,
`primary_phone`, `status`; **keep** `role` column, no longer authoritative).
Rename via new tables + backfill: `parents → parent_profiles`,
`teachers → teacher_profiles` (create new, copy rows, keep old as a VIEW for one
release).
Alter: `child_profiles` (+`date_of_birth date`).
Backfill:
- one `user_roles` per distinct `users.role`;
- one `parent_child_relationships` per `child_profiles.family_id` →
  `family_memberships.user_id` with `relationship_type='GUARDIAN'`,
  `is_legal_guardian=true`, `status='ACTIVE'`;
- `family_memberships` from `families.owner_parent_id` (`OWNER`) + `parents.user_id`
  (`GUARDIAN`).
Compat: a VIEW `children` = `child_profiles`; keep `parents`/`teachers` VIEWs.
Rollback: drop new tables + `users` columns; VIEWs make it clean.

### I2 — School + Academic Year + Subject + Classroom

New: `schools`, `academic_years`, `subjects`, `classrooms`, `class_cohorts`,
`teacher_school_memberships`, `teacher_class_assignments`.
Seed: `academic_years` (2025-26 … 2028-29) from MOET typical dates;
`subjects` (`MATH` ACTIVE, `VIETNAMESE`/`ENGLISH`/`SCIENCE` PLANNED).
Backfill: none required (green field for directory).
Compat: none broken.
Rollback: drop tables (no FK from older tables into these yet).

### I3 — Student Enrollment (history)

New: `student_school_enrollments`, `student_class_enrollments`,
`enrollment_transitions`.
Migrate: each `child_school_enrollment` row → one `student_school_enrollments`
(`status='ACTIVE'`, `source='PARENT'`, need a `school_id` — if the row has only a
`section_label` and no school, create a placeholder `schools` row per family with
`verification_status='UNVERIFIED'` OR leave `school_id` nullable for legacy rows
and require it on next guardian edit — **proposal: nullable `school_id` on
`student_school_enrollments` for legacy-migrated rows only, enforced NOT NULL for
new rows via a partial constraint**).
Compat: create a VIEW `child_school_enrollment` selecting the ACTIVE
`student_school_enrollments` (columns: `child_id, curriculum_id, grade,
academic_year, calendar_id, section_label, joined_on`) so
`CurriculumClockService` + `services/api` keep working unchanged until switched.
`CurriculumClockService` gets a small change: resolve via
`resolveActiveEnrollment(childId, asOf)` (doc 20 §5).
Rollback: drop new tables; the VIEW is replaced by the original table (kept
during I3).

### I4 — Relationship Request + Permission

New: `relationship_requests`, `teacher_child_links`, `teacher_parent_links`,
`permission_sets`, `permission_grants`, `privacy_preferences`, `audit_events`
(append-only trigger).
Migrate: each `teacher_invites` with `status='accepted'` →
- `teacher_child_links` (`access_source='PARENT_DIRECT'`, `subject_id=MATH`,
  `status='ACCEPTED'`, `initiated_by_role='PARENT'`,
  `accepted_by_parent_user_id` = the family owner);
- a minimal `permission_sets` + `permission_grants`
  (`{VIEW_CLASS_CONTEXT, SUBMIT_CURRENT_LESSON}` — pending anh's confirmation,
  doc 21 §12.1);
- an `audit_events` `RELATIONSHIP_MIGRATED` row.
`pending` invites → `relationship_requests` (`status='PENDING'`); `revoked` →
`teacher_child_links` `status='REVOKED'`.
Compat: `services/api` `requireChildAccess` gains a new branch — for a `TEACHER`
workspace it calls `can(...)`; the legacy `familyUserIds` path stays for `PARENT`.
Rollback: drop new tables; `teacher_invites` untouched.

### I5 — Teacher Learning Contributions

Alter `teacher_contributions` (+`subject_id`, `contribution_type`,
`relationship_source_type`, `relationship_source_id`, `confidence`, `visibility`,
`attachment_id`; tighten `actor_user_id → teacher_user_id uuid` with a nullable
legacy column).
Backfill: existing rows → `subject_id = MATH`, `contribution_type` inferred from
payload (`taught_skill_ids` → `CURRENT_LESSON`, `exam_ref` → `EXAM_NOTICE`, …),
`confidence = 'B'`, `visibility = 'PARENT_AND_CHILD'`.
Compat: the domain `TeacherContribution` type gains optional fields; the Resolver
reads `confidence` if present, else defaults (doc 13 behaviour preserved).
Rollback: drop the added columns.

### I6 — Academic Progression Engine

New: none (uses I3 tables) — service + a scheduled job design only.
Add: `class_cohorts.naming_pattern text`.
Compat: none.
Rollback: n/a (no schema beyond the small alter).

### I7 — Parent / Student / Teacher workspace APIs + UI

New: `audit_events` event types for workspace actions; no core schema.
The `AuthAdapter` + workspace-token endpoints (doc 22, doc 25).
Compat: the API moves from trusted `RequestContext` to derived-from-token; the
in-memory test path keeps an `InMemoryAuthAdapter`.

---

## 3. Learning-domain persistence (parallel track — required by spec §25/§B25)

The Twin / gap / plan / assignment / attempt / evidence tables in the DB-model
doc are **still in-memory**. They must be migrated (keyed by `child_id`) so
ownership traces to `child_id`. This is **independent of I1–I7** and can land
before or after; recommended as a group **IX** right after I1 (so `children`
exists as the FK target). Tables: `skill_states`, `problem_type_mastery`,
`thinking_profile`, `knowledge_gaps`, `learning_readiness`,
`actual_learning_frontier`, `learning_prescriptions`, `daily_plans`,
`assignments`, `assignment_items`, `attempts`, `attempt_answers`,
`weekly_reports`, `notifications`. Each `child_id → children` FK, append-only
where the DB-model doc marks `⊕`. **No conflict with C4/C5** — `generation_specs`
/ `generated_exercise_sets` already exist and `assignments` would reference
`generated_exercise_set_id` (nullable during the legacy path).

---

## 4. Backward-compatibility summary

| consumer | protection |
|---|---|
| `CurriculumClockService` | VIEW `child_school_enrollment` (I3) + `resolveActiveEnrollment` shim |
| `services/api` `requireChildAccess` (parent path) | unchanged (`family_memberships` backfill preserves `familyUserIds` semantics) |
| `services/api` `childToday` + SHADOW generation | unchanged — runs after projection |
| `@copilot/projections` / `assertChildSafe` | unchanged |
| domain `TeacherContribution` / `LessonConfirmationEvent` | optional new fields only |
| append-only triggers | reused pattern for `audit_events` |
| C4/C5 `generation_specs` / `generated_exercise_sets` | untouched |
| existing tests | `InMemory*` stores + `InMemoryAuthAdapter` keep the deterministic path |

---

## 5. Rollout risk & rollback

| group | risk | rollback |
|---|---|---|
| I1 | low (green DB) | drop new tables + `users` cols; VIEWs restore old names |
| I2 | very low (new directory) | drop tables |
| I3 | **medium** — clock + api read the enrollment | VIEW + shim; drop new tables; original `child_school_enrollment` retained through I3 |
| I4 | medium — `authorize` gains a teacher branch | feature-flag the teacher branch; drop new tables; `teacher_invites` retained |
| I5 | low — additive columns | drop columns |
| I6 | very low — service only | n/a |
| I7 | medium — auth cutover | keep `InMemoryAuthAdapter` + a `TRUSTED_CONTEXT` dev flag |

**Principle:** no group deletes a legacy table until its replacement has shipped,
been tested, and run in production for one release (matches the C5 "never break
the running demo" rule).
