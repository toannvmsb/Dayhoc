# I0 — Current-state audit results (identity / family migration safety)

> **Run:** 2026-09-02, against the portable Postgres pilot DB
> (`postgres://postgres@127.0.0.1:5432/parent_copilot`), migrations `1756512000000`
> … `1757116800000` applied (8 of 8 before I1).
> **Verdict:** green-field-safe for I1. No `users.role='child'` rows, no children,
> no `teacher_invites`. The only pre-existing rows are integration-test residue
> (users + families with no `parents`/`child_profiles`) — harmless to the additive
> I1 backfill.

---

## 1. Data snapshot (pre-I1)

| query | result |
|---|---|
| `SELECT role, count(*) FROM users GROUP BY role` | `parent → 5` (no `child`, `teacher`, `admin`) |
| `SELECT count(*) FROM child_profiles` | `0` |
| `SELECT count(*) FROM child_school_enrollment` | `0` |
| `SELECT status, count(*) FROM teacher_invites GROUP BY status` | `0 rows` |
| `SELECT count(*) FROM families` | `4` (each a distinct `owner_parent_id`; 1 of the 5 users owns none) |
| `SELECT count(*) FROM parents` | `0` |
| `SELECT count(*) FROM teachers` | `0` |
| `SELECT count(*) FROM evidence / teacher_contributions / consent_records` | `0 / 0 / 0` |

**Origin of the residue:** `packages/evidence/src/pg-store.integration.test.ts`
(and similar) insert `users(role) VALUES ('parent')` + `families(owner_parent_id)`
and, on teardown, delete only `child_profiles` (the `SET session_replication_role
= replica; DELETE FROM child_profiles` pattern). The parent `users` + `families`
rows are left behind. This is expected test debris, not seed data.

## 2. FK references to `users` where the domain concept could be a child

```
families.owner_parent_id      → users     (parent)
parents.user_id               → users     (parent)
teachers.user_id              → users     (teacher)
teacher_invites.invited_by    → users     (parent)
consent_records.granted_by    → users     (parent/guardian)
deletion_jobs.requested_by    → users
rights_requests.requested_by  → users
lesson_confirmations.confirmed_by → users (parent/teacher)
```

**No FK treats a `users` row as a child.** `child_profiles` /
`child_credentials` / `child_quick_access` / `evidence` / `child_school_enrollment`
all key on `child_profiles.id` (= `child_id`), never `users.id`. ID-Q2's "legacy
`users.role='child'`" concern **does not materialise** in this DB — zero such rows.

## 3. Code-coupling problems confirmed (unchanged from doc 19 §1.2)

| location | problem | I1 handling |
|---|---|---|
| `packages/domain/src/roles.ts` | `Role` single-valued, includes `'child'` | left intact; `@copilot/domain/identity.ts` adds `WorkspaceRole` (M:N). `roles.ts` untouched this phase. |
| `services/api` `RequestContext` / `requireChildAccess` | one role/request; teacher access = family-list membership | **not touched in I1** (auth cutover is I7). Documented risk. |
| `ApiDeps.childProfiles[…].enrollment` single-row | no history | I3. |
| `CurriculumClockService.positionFor` single enrollment | — | I3. |
| no auth implementation | `RequestContext` trusted | `AuthAdapter` port added (I1); `SupabaseAuthAdapter` + cutover = I7. |
| no `Subject` entity | Math implicit | I2. |

## 4. C4/C5 conflict check

**None.** Every C4/C5 artefact (`generation_specs`, `generated_exercise_sets`,
grounding, telemetry) keys on `child_id` / `generationSpecId`. I1 adds tables and
five nullable `users` columns; it does not alter `child_profiles.id`, any C4/C5
table, or the SHADOW generation wiring in `services/api` `childToday`.
`child_profiles.school_grade` (used by `buildExerciseGenerationSpec` for
`gradeContext`) is **not** modified by I1 — it becomes a cache with a sync rule
only when I3 introduces `student_school_enrollments`.

## 5. I1 backfill dry-run (verified 2026-09-02)

Ran the I1 migration `up` → `down` → `up` against this DB. Result:

| table | rows after backfill | note |
|---|---|---|
| `user_roles` | 5 (`PARENT` ×5) | one per `users.role='parent'`; no `STUDENT`/other invented |
| `family_memberships` | 4 (`OWNER` ×4) | one per `families.owner_parent_id`; no `parents` rows to add as `GUARDIAN` |
| `parent_child_relationships` | 0 | no `child_profiles` → nothing to relate |
| `parent_profiles` / `teacher_profiles` | 0 / 0 | no `parents` / `teachers` rows |

`down` cleanly drops every new table + the five `users` columns + the `children`
view. Reversibility confirmed.

## 6. Residue disposition

The 5 test-residue `users` + 4 `families` are left in place. The I1 backfill
processed them deterministically (§5). They carry no child data and no
`teacher_invites`, so they cannot produce an incorrect guardian relationship. A
follow-up cleanup of integration-test teardown (also delete the `users` /
`families` a test creates) is tracked separately — **not an I1 blocker**.
