# 27 — Identity / Relationship Migration Roadmap

> **Authority:** locked spec §17, §19, prompt §B33. Companion: [19](19_IDENTITY_FAMILY_MODEL.md)–[26](26_IDENTITY_RELATIONSHIP_GOLDEN_TEST_PLAN.md).
> **Status:** ID-Q1..Q10 RESOLVED (doc 19 §6). **I0..I7 BACKEND/DOMAIN
> FOUNDATION IMPLEMENTED** (anh 2026-09-02, continuous authorization) — commits
> `eab4069` (I0+I1), `17924dc` (I2+I3+I6), `27f7894` (I4), `98eadd4` (I5),
> `a00189c` (I7). IX (persist learning tables) + full API/UI cutover pending
> review — see `PENDING_APPROVAL.md` OD-1..OD-7.

---

## 0. Principle

Additive, incremental, **never break the running demo** (same rule as the C4/C5
migration). Each group: additive schema → domain types → services → API → tests →
compat/rollback. Legacy tables/assumptions are removed **only after** the
replacement has shipped and run for a release.

---

## 1. Group summary & dependencies

| group | scope | depends on | ships |
|---|---|---|---|
| **I0** | current-state audit (data checks, no schema) | — | audit doc |
| **I1** | Identity + Family: `user_roles`, `parent_child_relationships` (**capability authority model** — ID-Q6), `student_account_links`, `family_memberships`; `users`/`parent_profiles`/`teacher_profiles` extend; `child_profiles`+`date_of_birth`; `AuthAdapter` port + `InMemoryAuthAdapter`; `@copilot/identity` package | I0 | multi-role identity, capability-based guardian authority |
| **IX** | Learning-domain persistence: migrate the in-memory Twin/gap/plan/assignment/attempt tables to Postgres, keyed by `child_id` | I1 (needs `children` FK target) | `child_id` ownership for all learning data (spec §25) |
| **I2** | Education directory: `schools`, `academic_years`, `subjects`, `classrooms` (**no `class_cohorts`** — ID-Q7 deferred), `teacher_school_memberships`, `teacher_class_assignments` | I1 | school/class/subject entities |
| **I3** | Enrollment history: `student_school_enrollments`, `student_class_enrollments` (+`enrollment_type`, **one ACTIVE PRIMARY** partial-unique — Amendment 2), `enrollment_transitions`; compat VIEW `child_school_enrollment`; `resolveActiveEnrollment` + `resolveDefaultClassroom` | I2 | no-overwrite history, PRIMARY vs supplementary |
| **I4** | Relationship + permission: `relationship_requests`, `teacher_child_links`, `teacher_parent_links`, `permission_sets`, `permission_grants`, `privacy_preferences`, `audit_events`; `authorize` + `can(...)`; migrate `teacher_invites` | I1, I2, I3 (class privacy mode) | both-direction requests, scoped permissions, R-2 invariant |
| **I5** | Teacher contributions: extend `teacher_contributions` → `teacher_learning_contributions` (subject/type/source/confidence/visibility); Resolver reads new fields | I4 | subject-scoped, provenance-rich teacher evidence |
| **I6** | Academic Progression Engine: `determineProposal`, `confirmTransition`, year-end batch design; deterministic class-name heuristic (no cohort) | I3 | deterministic progression proposals |
| **I7** | Workspaces + APIs + UI: `SupabaseAuthAdapter`, workspace token, `/me/*`, relationship inbox, school/class picker, privacy controls; cut `services/api` from trusted `RequestContext` to token-derived | I1, I4, I6 | parent/student/teacher workspaces |

**Critical path:** I0 → I1 → I2 → I3 → I4 → I5 → I6 → I7.
**Parallelisable:** IX may run any time after I1; I5 after I4; I6 after I3.

---

## 2. Per-group detail

### I1 — Identity + Family

| item | detail |
|---|---|
| tables | ADD `user_roles`, `parent_child_relationships` (capability model — ID-Q6), `student_account_links`, `family_memberships`; ALTER `users` (+`auth_user_id`, `primary_email`, `primary_phone`, `status`, `display_name`); ALTER `child_profiles` (+`date_of_birth`); new `parent_profiles`/`teacher_profiles` + copy from `parents`/`teachers` |
| domain types | `@copilot/domain`: `WorkspaceRole = 'PARENT'\|'STUDENT'\|'TEACHER'\|'ADMIN'`; `ParentChildRelationshipType`; `RelationshipStatus`; `GuardianAuthoritySource`; `GuardianCapability` |
| services | new `@copilot/identity`: `IdentityService` (register, roles, workspace), `FamilyService`, `guardianAuthority(userId, childId)` / `authorisedGuardian(userId, childId, capability)`; `AuthAdapter` port + `InMemoryAuthAdapter`; in-memory + Pg stores |
| API | (design only in I1 — routes ship with I7) |
| tests | golden §1–5 + §12 tests A, I (55, 63); `child_id` unchanged through migration; multi-role; capability backfill |
| backward compat | VIEWs `children`=`child_profiles`, `parents`, `teachers`; `users.role` retained (denormalised); `family_memberships` + `parent_child_relationships` backfill preserves `ApiDeps.childProfiles[...].familyUserIds` semantics; legacy `users.role='child'` rows NOT auto-migrated (ID-Q2) |
| rollback | drop new tables + `users`/`child_profiles` cols; VIEWs restore names |
| risk | low — pilot DB effectively empty |

### IX — Learning-domain persistence

| item | detail |
|---|---|
| tables | `skill_states`, `problem_type_mastery`, `thinking_profile`, `knowledge_gaps`, `learning_readiness`, `actual_learning_frontier`, `learning_prescriptions`, `daily_plans`, `plan_items`, `assignments`, `assignment_items`, `attempts`, `attempt_answers`, `weekly_reports`, `notifications` — all `child_id → children` |
| services | Pg stores mirroring the existing in-memory ones (like `PgLedgerStore`, `PgGenerationStore`) |
| API | none new — swap the in-memory stores for Pg in `services/api` deps behind a flag |
| tests | integration tests gated on `DATABASE_URL` (existing pattern) |
| backward compat | in-memory stores stay for unit tests |
| risk | medium — the first time Twin state is persisted; recompute-from-evidence stays the source of truth (≈ derived) |

### I2 — Education directory

| item | detail |
|---|---|
| tables | ADD `schools`, `academic_years`, `subjects`, `classrooms`, `teacher_school_memberships`, `teacher_class_assignments` (**no `class_cohorts`** — ID-Q7) |
| seeds | `academic_years` 2025-26…2028-29; `subjects` (MATH ACTIVE) |
| domain types | `SchoolVerificationStatus`, `SubjectCode`, `ClassroomRef` |
| services | `SchoolDirectoryService` (search + de-dup + propose), `ClassroomService` |
| API | `/schools/*`, `/academic-years`, class propose |
| tests | golden §30–33 |
| backward compat | none broken (new directory) |
| rollback | drop tables |
| risk | very low |

### I3 — Enrollment history

| item | detail |
|---|---|
| tables | ADD `student_school_enrollments`, `student_class_enrollments`, `enrollment_transitions` |
| migrate | `child_school_enrollment` → `student_school_enrollments(ACTIVE)`; VIEW `child_school_enrollment` for compat |
| domain types | `EnrollmentStatus`, `PrivacyMode`, `EnrollmentSource` |
| services | `EnrollmentService`; `CurriculumClockService.resolveActiveEnrollment(childId, asOf)` |
| API | `/children/:id/enrollments*` |
| tests | golden §31, 33, 37, 38; clock still green |
| backward compat | VIEW + `resolveActiveEnrollment` shim; original `child_school_enrollment` table kept through I3 |
| rollback | drop new tables; VIEW replaced by the retained table |
| risk | **medium** — clock + api read enrollment; mitigated by the VIEW |

### I4 — Relationship + permission

| item | detail |
|---|---|
| tables | ADD `relationship_requests`, `teacher_child_links`, `teacher_parent_links`, `permission_sets`, `permission_grants`, `privacy_preferences`, `audit_events` (append-only trigger) |
| migrate | `teacher_invites` (`accepted`→link+minimal grants; `pending`→request; `revoked`→link REVOKED) |
| domain types | `PermissionCode` (the 15 codes), `RelationshipRequestStatus`, `AccessSource` |
| services | `RelationshipService` (create/accept/reject/cancel/revoke, concurrency rules), `PermissionService` (`can(...)`, `effectiveCodes(...)`), `authorize(ctx, resource, action)` |
| API | `/relationship-requests/*`, `/relationships/:id/*`, `/teacher/children/:id/permissions` |
| tests | golden §6–29, §50–54 |
| backward compat | `services/api` `requireChildAccess` gains a TEACHER branch calling `can(...)` behind a flag; PARENT path unchanged; `teacher_invites` retained |
| rollback | drop new tables; disable the flag |
| risk | medium — the authz cutover for teachers; feature-flagged |

### I5 — Teacher contributions

| item | detail |
|---|---|
| schema | ALTER `teacher_contributions` (+7 cols); VIEW keeps old name |
| migrate | backfill `subject_id=MATH`, infer `contribution_type`, `confidence='B'`, `visibility='PARENT_AND_CHILD'` |
| domain types | `TeacherContribution` gains optional `subjectId`, `contributionType`, `relationshipSource`, `confidence`, `visibility` |
| services | contribution endpoint enforces `can(SUBMIT_<type>, subject)`; Resolver reads `confidence` if present |
| API | `POST /teacher/children/:id/contributions` (subject-scoped) |
| tests | golden §44–48 |
| backward compat | optional fields; Resolver default behaviour preserved (doc 13) |
| rollback | drop added columns |
| risk | low |

### I6 — Academic Progression Engine

| item | detail |
|---|---|
| schema | none (deterministic class-name heuristic — doc 24 §2 / P-7) |
| services | `ProgressionEngine.determineProposal`, `EnrollmentService.confirmTransition`, year-end batch (design; scheduler is I7+) |
| API | `/children/:id/enrollment-transitions*` |
| tests | golden §34–43 |
| backward compat | none |
| rollback | n/a |
| risk | very low |

### I7 — Workspaces + APIs + UI

| item | detail |
|---|---|
| services | `SupabaseAuthAdapter`; workspace-token issuance/verification; `authorize` wired into every child route |
| API | cut `services/api` from `RequestContext` (trusted) to token-derived; add `/me/switch-workspace` enforcement |
| UI (`apps/web`, `apps/mobile`) | role picker, relationship inbox, school/class picker, privacy controls, enrollment-transition confirm screen |
| tests | golden §5, §54 end-to-end; auth adapter contract tests |
| backward compat | `InMemoryAuthAdapter` + a `TRUSTED_CONTEXT` dev flag for existing tests |
| rollback | keep the dev flag; revert route wiring |
| risk | medium — auth cutover |

---

## 3. Legacy removal (only after a release each)

| legacy | removed in / after |
|---|---|
| `users.role` authoritative use | after I1 stable |
| `parents` / `teachers` table names (VIEWs) | after I1 stable |
| `teacher_invites` | after I4 stable + migration verified |
| `child_school_enrollment` table (kept as VIEW) | after I3 stable + clock/api switched |
| trusted `RequestContext` path | after I7 stable |

---

## 4. Compatibility with C4/C5 (no conflict)

| C4/C5 asset | interaction | verdict |
|---|---|---|
| `generation_specs`, `generated_exercise_sets` | `child_id → child_profiles`(=`children`) | unchanged; FK target renamed via VIEW then real rename |
| `buildExerciseGenerationSpec` | `gradeContext` from ACTIVE enrollment (I3) instead of `child_profiles.school_grade` | additive — same value, better sourced |
| Learning Context Resolver (doc 13) | teacher contributions become richer weighted signals (I5) | preserved — guardrails A–F, `nodeType` eligibility, confidence weighting untouched |
| SHADOW generation in `services/api` `childToday` | runs after projection; `authorize` added before | unchanged behaviour, one gate added |
| C5.2 HC09 ESTIMATED-context path | a child with only a PROPOSED enrollment → clock null → evidence-only | this IS the HC09 behaviour — validated |
| append-only ledger triggers | `audit_events` reuses `reject_ledger_mutation` | consistent |

**No C4/C5 architecture is weakened.** The only behavioural change to generation
is that `gradeContext` is sourced from the enrollment history instead of a
single denormalised column — same number, better provenance.

---

## 5. Status / next action

1. ✅ **anh reviewed docs 19–27; ID-Q1..Q10 RESOLVED** (doc 19 §6); Amendments
   1–3 folded in (PRIMARY vs supplementary; class-context vs child-specific
   write; capability guardian authority).
2. ✅ **I0 + I1 APPROVED FOR IMPLEMENTATION** — `@copilot/identity` package +
   additive migration + golden tests §1–5 + §12 A/I. **In progress / this phase.**
3. **Do NOT** start I2+ until I1 is merged and green.
4. Phase A (Luna smoke) remains `BLOCKED_MISSING_API_KEY` — unrelated; runs when
   `OPENAI_API_KEY` is provided.
