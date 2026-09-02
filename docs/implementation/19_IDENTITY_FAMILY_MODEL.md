# 19 — Identity & Family Model

> **Authority:** `File du an/DayZi_Identity_Family_School_Relationship_Architecture_v1.0.md`
> (LOCKED product spec, anh 2026-09-02) §1, §2, §11, §12
> **+ FINAL PRODUCT DECISIONS (anh 2026-09-02): ID-Q1..Q10 RESOLVED** (§6 below).
> **Status:** ARCHITECTURE / SPEC — approved; I0+I1 in implementation. Companion docs:
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
| I-3 | **Learning data keys on `child_id`**, not `auth user_id`. The Learning Twin follows `child_id` across school / class / academic-year / teacher / student-account changes. `child_id` **never changes** through any identity migration. |
| I-4 | **Parent ↔ Child is many-to-many** through `parent_child_relationships` (ID-Q4). A `family` is a **household / billing / group** context, *not* the guardianship model. A Child may have authorised guardians associated through *different* family/household contexts. |
| I-5 | **Guardian authority is a modelled capability set, not `is_legal_guardian` alone** (ID-Q6). An unverified app assertion is never treated as a legal fact. |

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

Reuse existing `families(id, owner_parent_id → users, created_at)`. A family is a
**household / billing / group** context (one subscription plan per family). It is
**not** the guardianship model (ID-Q4) and it is **not** one-per-child in the
identity sense — a Child belongs to one billing family but may have guardians
reachable through other households.

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
| `family_id → families` | KEEP (billing/household home) — guardianship comes from `parent_child_relationships` (M:N), not this FK |
| `display_name` | KEEP |
| `school_grade` | **CACHE, not source of truth (ID-Q9).** The authoritative grade is the ACTIVE **PRIMARY** `student_school_enrollments.grade` (doc 20). `school_grade` stays as a derived/compat field, kept in sync by `EnrollmentService` on every enrollment change (sync rule: `children.school_grade := activePrimarySchoolEnrollment(child).grade`, or unchanged if none). Deprecated only after every reader is migrated. |
| `school_context jsonb`, `goals jsonb` | KEEP (goals feed the planner) |
| `available_time_profile`, `deletion_state` | KEEP |
| `date_of_birth date nullable` | **ADD** (guardian-provided; drives age-appropriateness + grade-boundary policy) |
| `created_at` | KEEP |

### 3.4 `parent_child_relationships` (ADD — I-4, I-5, ID-Q6)

Parent ↔ Child is **many-to-many**. Guardian authority is an **explicit
capability set with provenance**, never a single boolean.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `parent_user_id` | uuid → users | must hold `PARENT` role |
| `child_id` | uuid → children | |
| `relationship_type` | text | `FATHER | MOTHER | GUARDIAN | OTHER` |
| `can_manage_child` | boolean NOT NULL default false | edit profile, create enrollments, link a student account |
| `can_manage_privacy` | boolean NOT NULL default false | change privacy mode, grant/revoke sensitive permissions, run rights/deletion requests |
| `can_approve_teacher_relationships` | boolean NOT NULL default false | accept a teacher-initiated Teacher–Child request (R-2) |
| `authority_source` | text NOT NULL | `SELF_DECLARED | INVITED_BY_EXISTING_GUARDIAN | VERIFIED | MIGRATED_FAMILY_OWNER` |
| `is_legal_guardian` | boolean **nullable** | verification-aware hint only — **never the sole authorization predicate** (ID-Q6); null = unknown |
| `status` | text | `ACTIVE | REVOKED` |
| `valid_from`, `valid_until` | timestamptz nullable | |
| `created_at`, `revoked_at` | timestamptz | |
| unique | `(parent_user_id, child_id)` where `status='ACTIVE'` | |

**Authority resolution** — a single server-side function
`guardianAuthority(userId, childId) → { canManageChild, canManagePrivacy, canApproveTeacherRelationships }`
= the OR of all `ACTIVE parent_child_relationships` rows for `(userId, childId)`.
Helper `authorisedGuardian(userId, childId, capability)` returns true iff that
capability bit is set. Every privacy-critical action names the *capability* it
needs:

| action | capability |
|---|---|
| edit child profile / create enrollment / student-account link | `can_manage_child` |
| change privacy mode / grant sensitive permission / rights & deletion request | `can_manage_privacy` |
| accept a teacher-initiated Teacher–Child request | `can_approve_teacher_relationships` |

**Authority-source rules:**
- **`SELF_DECLARED`** — a parent who created the child or joined by an open link.
  Gets `can_manage_child = true`; `can_manage_privacy` / `can_approve_teacher_relationships`
  default **true for the child's first guardian**, and **false** for a
  self-declared *additional* guardian until an existing guardian grants them.
- **`INVITED_BY_EXISTING_GUARDIAN`** — added by another guardian; capabilities
  are exactly what the inviter chose.
- **`VERIFIED`** — identity/relationship verified out-of-band (future); may set
  `is_legal_guardian = true`.
- **`MIGRATED_FAMILY_OWNER`** — backfilled from `families.owner_parent_id` /
  `parents.user_id` during I1: `can_manage_child = can_manage_privacy =
  can_approve_teacher_relationships = true`, `is_legal_guardian = NULL`
  (**not** asserted as a legal fact — it is a migrated administrative authority).

An unverified app assertion of "I am the legal guardian" **never** flips
`is_legal_guardian` to true (I-5).

---

## 4. REUSE / EXTEND / ADD / DEPRECATE summary (identity + family)

| table | classification | note |
|---|---|---|
| `users` | EXTEND | + `auth_user_id`, `primary_email/phone`, `status`; drop reliance on `role` column |
| `user_roles` | ADD | M:N roles |
| `parent_profiles` | ADD (backfill from `parents`) | 1 per user; `parents` table kept untouched for one release |
| `teacher_profiles` | ADD (backfill from `teachers`) | + verification, subjects; `teachers` kept |
| `families` | REUSE | household / billing / group context |
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

**All resolved — see §6.**

---

## 6. FINAL PRODUCT DECISIONS — ID-Q1..Q10 RESOLVED (anh 2026-09-02)

| # | decision |
|---|---|
| **ID-Q1** *(auth)* | **LOCKED: Supabase Auth + Supabase Postgres for MVP.** Domain code stays behind `AuthAdapter`. Server-side application `authorize()` / `can()` is the **primary** business authorization layer. Postgres/Supabase **RLS is defence-in-depth where practical, not the only business authorization engine** (doc 22). |
| **ID-Q2** *(legacy `users.role='child'`)* | I0 audits all rows/usages. Legacy child-login identity migrates toward `student_account_links`. **Do not delete legacy rows immediately** — keep compatibility for ≥ one release / migration window. Child Profile stays independent of Student login. |
| **ID-Q3** *(legacy `teacher_invites`)* | An `accepted` invite → an `ACCEPTED teacher_child_links` **only if the existing data supports the relationship**, with a conservative **`LEGACY_MINIMAL`** permission profile. **Never** auto-grant `VIEW_SELECTED_GAPS`, `VIEW_LEARNING_TWIN_SUMMARY` or other sensitive Twin permissions — those need explicit Parent re-consent. `pending` → `relationship_requests`. `revoked` → history only (doc 21 §12). |
| **ID-Q4** *(child / family)* | **No one-family-per-child identity rule.** Parent ↔ Child is M:N through `parent_child_relationships`. `family` = household / billing / group context. A Child may have authorised guardians through different household contexts. Learning ownership stays `child_id`. |
| **ID-Q5** *(request expiry)* | Default **14 days, configurable** (a config value, not a constant). Expired request cannot be accepted; resend = new request (doc 21). |
| **ID-Q6** *(guardian authority)* | **`is_legal_guardian` alone is NOT the authority mechanism.** Model explicit capabilities (`can_manage_child`, `can_manage_privacy`, `can_approve_teacher_relationships`) + `authority_source` (`SELF_DECLARED | INVITED_BY_EXISTING_GUARDIAN | VERIFIED | MIGRATED_FAMILY_OWNER`). `is_legal_guardian` nullable / verification-aware, never the sole predicate. Migrated family owner → capabilities true, `authority_source = MIGRATED_FAMILY_OWNER`, `is_legal_guardian = NULL` (§3.4). |
| **ID-Q7** *(class cohort)* | **DEFER** persistent `class_cohorts` from initial MVP. Documented as OPTIONAL / FUTURE (doc 20 §2.5). Academic progression uses a **deterministic class-name suggestion heuristic** (`{grade}{letter}{stream}` continuation) — suggestion only, no identity semantics (doc 24). |
| **ID-Q8** *(package home)* | **LOCKED: `@copilot/identity`** for identity / family / role / relationship / permission / authorization domain logic. Education-specific enrollment/curriculum logic stays in the education/domain packages if the dependency direction is cleaner. **No circular dependencies.** |
| **ID-Q9** *(`children.school_grade`)* | **Not the future source of truth.** Source of truth = ACTIVE **PRIMARY** `student_school_enrollments.grade`. During migration `school_grade` is a derived/cache/compat field with an explicit sync rule (§3.3). Deprecate only after all readers migrate. |
| **ID-Q10** *(direct Parent evidence)* | **KEEP** direct Parent evidence creation. It must carry actor / provenance / source, be subject-scoped where applicable, and enter the normal `Evidence → Resolver / Gap / Twin` pipeline. It **must not** bypass `LearningContextResolver` or mutate the Twin directly (doc 21 §7). |
