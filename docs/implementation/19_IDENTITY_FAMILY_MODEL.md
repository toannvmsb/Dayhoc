# 19 — Identity & Family Model

> **Authority:** `File du an/DayZi_Identity_Family_School_Relationship_Architecture_v1.0.md`
> (LOCKED product spec, anh 2026-09-02) §1, §2, §11, §12.
> **Status:** ARCHITECTURE / SPEC ONLY — no feature code. Companion docs:
> [20](20_SCHOOL_CLASS_ENROLLMENT_MODEL.md), [21](21_LEARNING_RELATIONSHIP_PERMISSION_MODEL.md),
> [22](22_AUTH_AND_WORKSPACE_ARCHITECTURE.md), [23](23_DATABASE_MIGRATION_PLAN.md),
> [24](24_ACADEMIC_PROGRESSION_ENGINE.md), [25](25_IDENTITY_RELATIONSHIP_API_PLAN.md),
> [26](26_IDENTITY_RELATIONSHIP_GOLDEN_TEST_PLAN.md), [27](27_IDENTITY_MIGRATION_ROADMAP.md).

---

## 0. Locked invariants (from the spec)

| # | Invariant |
|---|---|
| I-1 | **Child ≠ User.** A Child Profile exists without any Student login. A Student account may LINK to an existing Child later — never create a duplicate. |
| I-2 | **User ≠ Role.** One identity may hold PARENT + STUDENT + TEACHER simultaneously. Each role has an independent workspace/permission surface; all share one Identity/Auth. |
| I-3 | **Learning data keys on `child_id`**, not `auth user_id`. The Learning Twin follows `child_id` across school / class / academic-year / teacher / student-account changes. |
| I-4 | A Child may have **multiple parents/guardians**; privacy-critical actions must name the authorised consent-giver. |

---

## 1. Current-state audit (I0)

### 1.1 What already exists (migration `1756598400000_evidence_ledger` + `1756684800000_privacy_foundation`)

| Table | Shape today | Verdict |
|---|---|---|
| `users` | `id uuid PK`, **`role text CHECK IN (parent,child,teacher,admin)`** (single), `locale` | **EXTEND** — role must become M:N; a `child` role value is a modelling smell (Child ≠ User). |
| `families` | `id`, `owner_parent_id → users` | REUSE + EXTEND (add `family_memberships`). |
| `parents` | `id`, `user_id → users`, `family_id → families`, `display_name` | **RENAME→`parent_profiles`** (1 row per user; drop `family_id`, move to `family_memberships`). |
| `teachers` | `id`, `user_id → users` | **RENAME→`teacher_profiles`**, add profile fields. |
| `child_profiles` | `id uuid PK`, **`family_id → families`** (single), `display_name`, `school_grade smallint`, `school_context jsonb`, `goals jsonb`, `available_time_profile`, `access_pin`, `deletion_state` | **REUSE as `children`** (id stays = `child_id` everywhere). `family_id` single-FK → replace with `parent_child_relationships`. `access_pin` already moved to `child_quick_access`. |
| `child_credentials` | `child_id PK`, `username`, `password_hash`, `must_change_password` | REUSE — this is already "Student login is optional, keyed by child". Rename/relate to `student_account_links`. |
| `child_quick_access` | `child_id`, `pin_hash`, `device_ref`, `scope='assigned_work'` | REUSE unchanged (PIN = shortcut, not login — spec §1). |
| `teacher_invites` | `id`, `family_id`, `child_id`, `teacher_id?`, `class_ref text`, `status IN (pending,accepted,revoked)`, `invited_by` | **DEPRECATE** — replaced by `relationship_requests` + `teacher_child_links` (doc 21). Parent-initiated only, no permissions, no teacher-initiated, `class_ref` is free text. |
| `consent_records` | `id`, `child_id`, `granted_by → users`, `relationship`, `data_categories jsonb`, `purpose`, `processor`, `policy_version`, … | REUSE (privacy layer). Add `privacy_preferences` (doc 21 §8). |
| `evidence`, `teacher_contributions`, `lesson_confirmations`, `uploads` | append-only, keyed by `child_id`; `teacher_contributions.actor_user_id`, `lesson_confirmations.confirmed_by` | REUSE. `teacher_contributions` EXTEND with `subject_id`, `relationship_source_type/id`, `contribution_type`, `confidence`, `visibility` (doc 21 §7). |
| Twin / gaps / plans / assignments / attempts | **NOT migrated** (in-memory + DB-model doc only) | ADD later, all keyed by `child_id` — see doc 25 §B25. |
| `generation_specs`, `generated_exercise_sets` | migrated (C4), `child_id → child_profiles` | REUSE unchanged — C4/C5 compatible. |

### 1.2 Coupling / assumption problems found in code

| Location | Problem |
|---|---|
| `packages/domain/src/roles.ts` | `Role` is a single value; `ROLES` includes `'child'`. |
| `services/api/src/api.ts` `RequestContext` | `{ userId, role: Role, childScope? }` — one role per request, no workspace concept. |
| `services/api/src/api.ts` `requireChildAccess` | parent/teacher access = `rec.familyUserIds.includes(ctx.userId)` — **a Teacher gets full child access just by being in the family list**. No relationship, no permission scope, no subject scope. |
| `ApiDeps.childProfiles[childId].enrollment` | single `{ curriculum, academicYear, calendarId? }` — no history, no school/class entity. |
| `packages/curriculum-clock` | `CurriculumClockService.positionFor(child, …)` takes `{ curriculum, grade, academicYear, calendarId? }` — expects a single current enrollment. |
| No auth implementation | No Supabase/JWT/session code anywhere; `RequestContext` is trusted caller input. |
| No `Subject` entity | `gradeContext` + Math KB are implicitly the only subject. |

### 1.3 Conflicts with C4/C5 generation architecture

**None that block.** Every C4/C5 artefact (spec, grounding, generated set, assignment, attempt, evidence, telemetry) already keys on `child_id` / `generationSpecId`. The Learning Context Resolver's "evidence + provenance, never absolute truth" model is exactly what this spec wants for School/Class/Teacher data. The one integration point: `CurriculumClockService` currently reads the single `child_school_enrollment` row; once `student_school_enrollments` (history) exists, the clock must resolve *the ACTIVE enrollment for the child as-of a date* — a thin resolver change, additive (doc 23 I3, doc 24 §5).

---

## 2. Identity architecture

```
auth provider (Supabase Auth / compatible)
        │  (auth_user_id, email/phone, verified)
        ▼
users                         one row per human identity
  ├── user_roles              M:N  → { PARENT | STUDENT | TEACHER | ADMIN }
  ├── parent_profiles         0..1 (present iff PARENT role)
  ├── teacher_profiles        0..1 (present iff TEACHER role)
  └── student_account_links   0..N → children   (present iff STUDENT role, one per linked child)
```

- **`users`** is the domain identity. It carries `auth_user_id` (nullable — a
  Child with no login has no `users` row at all; a pending teacher-invite target
  by email has a `users` row with `auth_user_id = null` until they sign up).
- **`user_roles`** grants a role. A role is *held*, not *assigned to a row*.
- A person who is both a parent and a math teacher has: 1 `users` row, 2
  `user_roles` (`PARENT`, `TEACHER`), 1 `parent_profiles`, 1 `teacher_profiles`.
- **Workspace** (doc 22) = the role the client is currently acting as. Auth
  issues one session; the client picks a workspace; the API enforces that every
  request's declared workspace is a role the user actually holds.

### 2.1 `users`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | domain identity id — stable forever |
| `auth_user_id` | text UNIQUE **nullable** | provider subject id; null = no login yet |
| `primary_email` | citext nullable | for discovery / notification only |
| `primary_phone` | text nullable | |
| `display_name` | text nullable | |
| `locale` | text NOT NULL default `'vi'` | (from existing `users.locale`) |
| `status` | text | `ACTIVE | SUSPENDED | DELETED` |
| `created_at` | timestamptz | |

### 2.2 `user_roles`

| column | type | notes |
|---|---|---|
| `user_id` | uuid → users | |
| `role` | text | `PARENT | STUDENT | TEACHER | ADMIN` |
| `granted_at` | timestamptz | |
| `granted_by` | uuid → users nullable | self-serve register → null; admin grant → admin id |
| PK | `(user_id, role)` | |

### 2.3 `parent_profiles` / `teacher_profiles`

`parent_profiles(user_id PK → users, display_name, contact_visibility, created_at)`

`teacher_profiles(user_id PK → users, display_name, headline nullable, subjects_taught jsonb default '[]', verification_status text default 'UNVERIFIED', created_at)`
— `verification_status ∈ { UNVERIFIED | COMMUNITY_VERIFIED | SYSTEM_VERIFIED }`.

### 2.4 `student_account_links` (I-1)

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid → users | the STUDENT identity |
| `child_id` | uuid → children | the pre-existing profile |
| `linked_by_user_id` | uuid → users | who approved the link (a guardian) |
| `link_method` | text | `PARENT_INVITE | CLAIM_CODE | GUARDIAN_MANUAL` |
| `status` | text | `ACTIVE | REVOKED` |
| `created_at`, `revoked_at` | timestamptz | |
| unique | `(child_id)` where `status='ACTIVE'` | one active student per child |

**Flow:** Parent creates `children` row → `child_id` exists, Twin starts. Later
the student registers (`users` + `user_roles STUDENT`) and a guardian approves a
`student_account_links` row pointing at the existing `child_id`. `child_credentials`
(existing table) is the parent-managed username/password the student then uses;
`student_account_links` records the *identity → child* binding and its provenance.
**No new `children` row is ever created for an account link.**

---

## 3. Family model

```
families ──< family_memberships >── users        (guardians of a family unit)
   │
   └──< children                                  (a child belongs to 1 family unit for billing/ownership)
             │
             └──< parent_child_relationships >── users   (M:N guardianship, typed)
```

### 3.1 `families`

Reuse existing `families(id, owner_parent_id → users, created_at)`. A family is
the **billing + ownership boundary** (one subscription plan per family). It is
*not* the guardianship model.

### 3.2 `family_memberships` (ADD)

| column | type | notes |
|---|---|---|
| `family_id` | uuid → families | |
| `user_id` | uuid → users | |
| `member_role` | text | `OWNER | GUARDIAN | VIEWER` |
| `joined_at` | timestamptz | |
| PK | `(family_id, user_id)` | |

### 3.3 `children` (REUSE `child_profiles`)

Keep the table and its `id` (= `child_id` used across the whole learning domain).

| column | keep / change |
|---|---|
| `id` | KEEP (PK, `child_id`) |
| `family_id → families` | KEEP (ownership/billing home) — but guardianship comes from `parent_child_relationships`, not this FK |
| `display_name` | KEEP |
| `school_grade` | **DEPRECATE-LATER** — the authoritative grade becomes the ACTIVE `student_school_enrollments.grade` (doc 20). Keep as a denormalised cache initially. |
| `school_context jsonb`, `goals jsonb` | KEEP (goals feed the planner) |
| `available_time_profile`, `deletion_state` | KEEP |
| `date_of_birth date nullable` | **ADD** (guardian-provided; drives age-appropriateness + grade-boundary policy) |
| `created_at` | KEEP |

### 3.4 `parent_child_relationships` (ADD — I-4)

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `parent_user_id` | uuid → users | must hold `PARENT` role |
| `child_id` | uuid → children | |
| `relationship_type` | text | `FATHER | MOTHER | GUARDIAN | OTHER` |
| `is_legal_guardian` | boolean NOT NULL default false | **the consent authority** for privacy-critical actions |
| `status` | text | `ACTIVE | REVOKED` |
| `valid_from`, `valid_until` | timestamptz nullable | |
| `created_at` | timestamptz | |
| unique | `(parent_user_id, child_id)` where `status='ACTIVE'` | |

**Consent authority rule:** an action that shares Child learning data (accepting
a teacher-initiated child request, changing a privacy mode, granting a sensitive
permission) requires an **`ACTIVE` relationship with `is_legal_guardian = true`**,
OR — if no legal guardian is recorded — any `ACTIVE` guardian, with the action
logged for the others to see and contest. This "authorised guardian" check is a
single server-side function `authorisedGuardian(userId, childId)` reused
everywhere (doc 22 §5, doc 27).

---

## 4. REUSE / EXTEND / ADD / DEPRECATE summary (identity + family)

| table | classification | note |
|---|---|---|
| `users` | EXTEND | + `auth_user_id`, `primary_email/phone`, `status`; drop reliance on `role` column |
| `user_roles` | ADD | M:N roles |
| `parent_profiles` | EXTEND (rename `parents`) | 1 per user; drop `family_id` |
| `teacher_profiles` | EXTEND (rename `teachers`) | + verification, subjects |
| `families` | REUSE | billing/ownership boundary |
| `family_memberships` | ADD | |
| `children` | REUSE (rename `child_profiles`) | id = `child_id` forever |
| `parent_child_relationships` | ADD | typed M:N guardianship |
| `student_account_links` | ADD | I-1 |
| `child_credentials` | REUSE | student username/password |
| `child_quick_access` | REUSE | PIN shortcut |
| `teacher_invites` | DEPRECATE-LATER | superseded by doc 21 |
| `consent_records` | REUSE | |
| `privacy_preferences` | ADD | doc 21 §8 |

---

## 5. Open questions (identity/family)

1. **`users.role` value `'child'`** — do any current rows use it? If a Child was
   ever given a `users` row, migration I1 must detach the learning data (keyed by
   `child_id` already, so low risk) and delete the `users` row, OR keep it as a
   `STUDENT`-role user linked via `student_account_links`. Needs a data check in
   I0 (`SELECT count(*) FROM users WHERE role='child'`).
2. **Auth provider** — Supabase Auth is the spec's preference. Confirm before I1
   whether we adopt Supabase-hosted Postgres too (affects RLS strategy, doc 22 §7).
3. **One family per child** vs a child straddling two families (divorced parents,
   separate subscriptions). Spec allows multiple guardians but `children.family_id`
   is single. Proposal: keep single `family_id` (billing home) + allow guardians
   from other families via `parent_child_relationships`; a guardian outside the
   billing family gets guardianship rights but not billing control. Confirm.
