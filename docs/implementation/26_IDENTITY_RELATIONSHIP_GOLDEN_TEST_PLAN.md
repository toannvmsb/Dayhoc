# 26 — Identity / Relationship Golden & Acceptance Test Plan

> **Authority:** locked spec §16, prompt §B32. Companion: [19](19_IDENTITY_FAMILY_MODEL.md)–[25](25_IDENTITY_RELATIONSHIP_API_PLAN.md).
> **Status:** TEST PLAN ONLY — no test code in this phase.

---

## 0. Shape

- Deterministic, in-memory (`InMemoryAuthAdapter`, `InMemoryLedgerStore`,
  `InMemory*` stores) — same pattern as the existing golden suites. No network.
- One test file per group under `packages/testing/src/identity/` (or a new
  `@copilot/identity` package with its own tests), driven by a scenario builder
  `buildIdentityScenario({ users, roles, families, children, schools, ... })`.
- Every test asserts **server-side** authorization (call the service/`authorize`
  directly, not a UI).
- Golden = **invariant-driven** (like the twin/planner golden): assert the
  invariant, not a frozen row dump.

---

## 1. Identity (spec §16.1–3)

| # | scenario | assert |
|---|---|---|
| 1 | Parent creates Child; no Student account | `children` row + `parent_child_relationships(is_legal_guardian=true)`; **no `users` row for the child**; Twin bootstrap keyed by `child_id`. |
| 2 | Student registers later, claims code, guardian approves | `student_account_links(status=ACTIVE)` points at the **existing** `child_id`; `children` count unchanged (no duplicate). |
| 3 | no duplicate child on any link path | after §2, `SELECT count(*) FROM children WHERE ...` == 1. |
| 4 | one User holds PARENT + TEACHER | `user_roles` has both; `parent_profiles` + `teacher_profiles` both present. |
| 5 | workspace switch | `POST /me/switch-workspace TEACHER` succeeds; `POST /me/switch-workspace ADMIN` (not held) → `403`. |

---

## 2. Relationship — parent-initiated (spec §16.4, 6, 7)

| # | scenario | assert |
|---|---|---|
| 6 | Parent invites Teacher (subject=MATH, proposes `{SUBMIT_CURRENT_LESSON, VIEW_ASSIGNMENT_COMPLETION}`) | `relationship_requests(PENDING)`; teacher is required responder. |
| 7 | Teacher accepts | `teacher_child_links(ACCEPTED)` + `permission_grants` for the 2 codes; `audit_events` written. |
| 8 | correct scoped permissions active | `can(teacher, child, SUBMIT_CURRENT_LESSON, MATH)` == true; `can(..., VIEW_SELECTED_GAPS, MATH)` == **false** (not granted, default OFF). |
| 9 | Teacher rejects | no link; request `REJECTED`; `can(...)` all false. |

---

## 3. Relationship — teacher-initiated (spec §16.5, R-2)

| # | scenario | assert |
|---|---|---|
| 10 | Teacher requests Parent connection | `relationship_requests(PENDING, target_type=PARENT)`; no `teacher_parent_links`. |
| 11 | Teacher requests Child connection | `relationship_requests(PENDING, target_type=CHILD, accepted_by_parent_user_id=NULL)`; **no `teacher_child_links`, no `permission_grants`**. |
| 12 | **BEFORE guardian acceptance** | `GET /children/:id` as that teacher → `403`; `can(teacher, child, <any code>, MATH)` == false; `POST /teacher/children/:id/contributions` → `403`; teacher `accept`-ing own request → `403`. |
| 13 | authorised guardian accepts with `approvedPermissions ⊂ proposed` | `teacher_child_links(ACCEPTED, accepted_by_parent_user_id set)`; only the approved subset in `permission_grants`. |
| 14 | only approved permissions activate | a proposed-but-not-approved code → `can(...)` false. |
| 15 | guardian rejects | request `REJECTED`; no link. |
| 16 | no Child relationship becomes active on reject | `teacher_child_links` count 0. |
| 17 | guardian revokes an ACCEPTED link | link `REVOKED`, grants `REVOKED`. |
| 18 | future access stops immediately | `can(...)` false right after revoke; a request in-flight fails. |

---

## 4. Relationship edge cases (spec §5.5, prompt)

| # | scenario | assert |
|---|---|---|
| 19 | Parent and Teacher send requests to each other for the same (teacher, child, subject) | both `relationship_requests` exist; first `accept` creates the link; the other request → `CANCELLED (SUPERSEDED_BY_EXISTING_LINK)`; exactly one `teacher_child_links`. |
| 20 | duplicate PENDING request | 2nd `POST /relationship-requests` returns the existing request (partial-unique); no 2nd row. |
| 21 | expired request then resend | old row `EXPIRED`; new `POST` creates a fresh `PENDING` row. |
| 22 | multiple guardians | guardian A accepts; `accepted_by_parent_user_id = A`; guardian B sees it in `audit_events` and can `revoke`. |
| 23 | teacher has CLASS + PARENT_DIRECT grants | two `teacher_child_links` (or grants from 2 sources); `effectiveCodes` == union. |
| 24 | guardian revokes PARENT_DIRECT, CLASS remains | the `PARENT_DIRECT` grants → `REVOKED`; `CLASS_ASSIGNMENT` grants stay; `can(...)` now only class-scoped codes; `VIEW_*` Twin codes → false. |
| 25 | effective permissions recalculate | after §24, `can(teacher, child, VIEW_SELECTED_MASTERY, MATH)` reflects only the class source + privacy mode gate. |

---

## 5. Class / privacy (spec §16.10, 14–16; R-4)

| # | scenario | assert |
|---|---|---|
| 26 | Teacher-Class assignment only (no child link) | `can(teacher, child, VIEW_LEARNING_TWIN_SUMMARY, MATH)` == false; `GET /teacher/children/:id/twin-summary` → `403`. |
| 27 | `PRIVATE_LEARNING` | child receives no class context; teacher sees nothing; `student_class_enrollments.privacy_mode = PRIVATE_LEARNING`. |
| 28 | `LINKED_PRIVATE` | child's `learning-context` includes class current-lesson (as `VIEW_CLASS_CONTEXT` evidence via Resolver); teacher `can(VIEW_*Twin*)` == false. |
| 29 | `LINKED_SHARED` + guardian grants `VIEW_SELECTED_MASTERY` for skills {A,B} | teacher sees mastery for A,B only; C is absent; raw evidence absent. |

---

## 6. School / academic year (spec §16.11–13)

| # | scenario | assert |
|---|---|---|
| 30 | two schools, same `official_name`, different `address` | two distinct `school_id`s; `propose` de-dup surfaces both, does not merge. |
| 31 | Parent selects existing school + class | `student_school_enrollments` + `student_class_enrollments` reference existing rows. |
| 32 | Parent proposes a missing class | `classrooms(UNVERIFIED, created_by=parent)`; enrollment references it. |
| 33 | same `class_name` different academic year | `classrooms` for `(school, 2026-27, 7, "7C0")` and `(school, 2027-28, 8, "8C0")` are different `classroom_id`s. |

---

## 7. Academic progression (spec §16.17–23; P-1..P-5)

| # | scenario | assert |
|---|---|---|
| 34 | 2026-27 Grade 7 ACTIVE, year closes | `enrollment_transitions(PROPOSED, PROMOTION, to_grade=8, to_academic_year=2027-28)`; old enrollment still `ACTIVE` (not yet completed). |
| 35 | `7C0 → 8C0` is a suggestion | `enrollment_transitions.suggested_class_name = '8C0'`; `to_classroom_id = NULL`. |
| 36 | Parent confirms but changes class to `8A2` | confirm creates/uses `classrooms(..., "8A2")`; new `student_class_enrollments` → `8A2`; transition `CONFIRMED`. |
| 37 | Child transfers school mid/after year | `SCHOOL_TRANSFER`; old school enrollment → `TRANSFERRED`; new `student_school_enrollments(ACTIVE)`; **old row unchanged in content**. |
| 38 | historical enrollment intact | after §37, the 2026-27 Grade 7 row still exists with its original `school_id`, `grade`, `status` history. |
| 39 | Grade 5→6 | `enrollment_transitions.requires_school_confirmation = true`, `to_school_id = NULL`; confirm blocked until guardian picks a school. |
| 40 | Grade 9→10 | same as §39. |
| 41 | repeat grade | guardian creates `REPEAT_GRADE` (`to_grade = from_grade`); no auto +1; old row → `REPEATED`. |
| 42 | manual correction | `MANUAL_CORRECTION` with a reason; old row → `WITHDRAWN`; new `ACTIVE`; `audit_events` records the reason. |
| 43 | Twin continuity | across §34–42 the Twin, gaps, generation specs still key on the same `child_id`; no recompute triggered by a transition; `skill_states` row count unchanged. |

---

## 8. Learning architecture (spec §16.24–28; R-7, E-5)

| # | scenario | assert |
|---|---|---|
| 44 | Teacher `CURRENT_LESSON` contribution (permission granted) | `teacher_learning_contributions` row (append-only) → mapped to `LessonConfirmationEvent(source=TEACHER_UPDATE)` → `resolveLearningContext` output changes; **`twin` not mutated directly** (no write path). |
| 45 | Teacher cannot mutate Twin | there is no `POST` that writes `skill_states` / `knowledge_gaps` for a teacher; attempt → `404`/`403`. |
| 46 | conflicting Parent / Teacher / schoolwork evidence | all three become weighted signals; `resolveLearningContext` guardrails A–F + `nodeType` eligibility decide; assert the deterministic resolution (e.g. recent VERIFIED school_test wins over an older teacher note). |
| 47 | provenance preserved | the contribution row + resulting evidence carry `relationship_source_type` + `relationship_source_id`. |
| 48 | subject-scope enforcement | a `SUBJECT_TEACHER` for `VIETNAMESE` calls `POST /teacher/children/:id/contributions { subjectId: MATH }` → `403`; nothing written. |
| 49 | assignment / attempt / evidence trace to `child_id` | every row created in a generation→assignment→attempt→evidence flow has `child_id` reachable by FK; no orphan keyed only by `user_id`. |

---

## 9. Security (spec §15, §16.50–54)

| # | scenario | assert |
|---|---|---|
| 50 | Teacher cannot enumerate arbitrary children | `GET /me/children` / any list returns only class-join-opted-in + linked children, display-name + class only; no `name`/`school`/PII search endpoint exists. |
| 51 | revoked relationship → child endpoint | `GET /children/:id` (teacher, link `REVOKED`) → `403`; `audit_events(CHILD_DATA_ACCESS_DENIED)`. |
| 52 | PENDING relationship → child endpoint | `403` (R-2). |
| 53 | expired relationship → child endpoint | `403`. |
| 54 | UI permission is not sufficient | call the service directly with a workspace token that has no grant → `403`; assert the API rejects regardless of any client flag. |

---

## 10. Coverage matrix (must all be green before I7 ships)

| dimension | covered by |
|---|---|
| Child-without-login | 1, 43, 49 |
| Student links later, no dup | 2, 3 |
| Multi-role user | 4, 5 |
| Parent-initiated accept/reject | 6–9 |
| Teacher-initiated ZERO-access invariant | 10–18, 51–53 |
| Accept subset of proposed permissions | 13, 14 |
| Revoke → immediate | 17, 18, 24, 51 |
| Simultaneous / duplicate / expired requests | 19–21 |
| Multiple guardians | 22 |
| Multi-source grants + partial revoke | 23–25 |
| Class ≠ Twin | 26–29 |
| Privacy modes | 27–29 |
| School identity by (name,address) | 30 |
| Classroom versioned by academic year | 33 |
| Grade 7→8 proposal, class suggestion only | 34–36 |
| Class change / school transfer / history intact | 36–38 |
| Grade 5→6, 9→10 boundary | 39, 40 |
| Repeat / correction / graduation | 41, 42 |
| Twin continuity across enrollment change | 43 |
| Teacher contribution → evidence/resolver, not Twin | 44–47 |
| Subject scope | 48 |
| child_id ownership | 49 |
| Anti-enumeration | 50 |
| Server-side authz | 51–54 |

---

## 11. Open questions (tests)

1. Package home — a new `@copilot/identity` package with `IdentityService`,
   `RelationshipService`, `EnrollmentService`, `ProgressionEngine` + these golden
   tests, or fold into `services/api`? Proposal: new package (mirrors
   `@copilot/evidence` / `@copilot/gap-engine` boundary discipline).
2. Scenario dataset — hand-built fixtures (proposed, like C5.2 hard cases) vs a
   vendored JSONL golden dataset from anh (like twin/planner). Proposal:
   hand-built for the state-machine tests; a vendored dataset later for scale.
