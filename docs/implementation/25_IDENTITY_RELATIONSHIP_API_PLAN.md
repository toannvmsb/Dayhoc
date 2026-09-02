# 25 — Identity / Relationship API Plan

> **Authority:** locked spec §14, §15. Companion: [21](21_LEARNING_RELATIONSHIP_PERMISSION_MODEL.md),
> [22](22_AUTH_AND_WORKSPACE_ARCHITECTURE.md).
> **Status:** API DESIGN ONLY — no route implementation in this phase.

---

## 0. Conventions

- Every endpoint runs `authorize(ctx, resource, action)` (doc 22 §5) **server-side**
  before touching data. The tables below name the check.
- `ctx = { userId, workspace, childScope? }` derived from the workspace token
  (doc 22 §4) — never from client-asserted fields.
- Child-data responses pass the role/workspace projector + `assertChildSafe`
  where the audience is the student.
- All state-changing relationship/enrollment endpoints write an `audit_events` row.
- Errors: `401` unauthenticated · `403 AuthzError` · `404 NotFoundError` ·
  `409` state conflict · `422` validation.
- **Guardian checks are capability-scoped (ID-Q6).** Where a row below says
  "`authorisedGuardian`", the required capability is named in parentheses:
  `(manage_child)` = `can_manage_child`, `(manage_privacy)` = `can_manage_privacy`,
  `(approve_teacher)` = `can_approve_teacher_relationships` (doc 19 §3.4). Never
  `is_legal_guardian`.
- **`POST /teacher/children/:id/contributions` splits CLASS_CONTEXT_WRITE from
  CHILD_SPECIFIC_WRITE (doc 21 §3.1).** A CLASS_CONTEXT_WRITE code
  (`SUBMIT_CURRENT_LESSON`, `SUBMIT_CURRICULUM_PROGRESS`, `SUBMIT_HOMEWORK`,
  `SUBMIT_EXAM_NOTICE`, `SUBMIT_EXAM_SCOPE`) may resolve via an ACTIVE
  Teacher–Class–Subject assignment (all six §3.1 conditions). A CHILD_SPECIFIC_WRITE
  code (`SUBMIT_SKILL_ASSESSMENT`, `SUBMIT_LEARNING_OBSERVATION`,
  `BEHAVIOUR_OBSERVATION`, identifying `SUBMIT_TEST_RESULT`) requires an explicit
  `PARENT_DIRECT` grant → otherwise `403`.

---

## 1. Auth & identity

| method / path | body | authorization | notes |
|---|---|---|---|
| `POST /auth/register` | `{ email?/phone?, password, intendedRole: PARENT\|STUDENT\|TEACHER }` | none | `AuthAdapter.createUser` → `users` + `user_roles`. STUDENT self-register creates NO child. |
| `POST /auth/login` | `{ email?/phone?, password }` | none | returns session JWT. |
| `GET /me/roles` | — | authenticated | `{ userId, roles[], profiles:{parent?,teacher?}, defaultWorkspace }` |
| `POST /me/switch-workspace` | `{ workspace }` | `workspace ∈ user_roles` | returns short-lived workspace token. |
| `POST /children/:id/student-link/invite` | `{ }` | PARENT + `authorisedGuardian(manage_child)` | issues a single-use claim code for a student to link. |
| `POST /me/student-link/claim` | `{ claimCode }` | STUDENT | creates `student_account_links` (PENDING guardian approval if not pre-approved). |
| `POST /children/:id/student-link/:linkId/approve` | — | PARENT + `authorisedGuardian(manage_child)` | activates the link. **No new child.** |

---

## 2. Child

| method / path | authorization | notes |
|---|---|---|
| `POST /children` | PARENT | `{ displayName, dateOfBirth?, grade?, goals? }` → `children` + `parent_child_relationships` (creator = `authority_source='SELF_DECLARED'`, all three capability flags `true`, `is_legal_guardian=NULL`) + `family_memberships`. `child_id` exists immediately; Twin bootstrap. |
| `GET /children/:id` | PARENT: `authorisedGuardian` · STUDENT: `childScope==id` (child-safe) · TEACHER: `can(VIEW_CLASS_CONTEXT ∨ any granted)` — teacher sees display name + class + granted fields only | |
| `GET /me/children` | PARENT: guardian rows · STUDENT: the linked child · TEACHER: children via `teacher_class_assignments` opt-in + `teacher_child_links` — **display name + class only**, never enumerable PII | |

---

## 3. School / class

| method / path | authorization | notes |
|---|---|---|
| `GET /schools/search?q=&province=&district=` | authenticated | fuzzy `(name, province, district)`; returns candidates + `verification_status`. **No child data.** |
| `POST /schools/propose` | authenticated | de-dup check first; creates `schools` (`UNVERIFIED`, `created_by`). |
| `GET /schools/:id/classes?academicYearId=` | authenticated | `classrooms` for that school+year. |
| `POST /schools/:id/classes/propose` | authenticated | creates a `classrooms` row (`UNVERIFIED`). |
| `GET /academic-years` | authenticated | list. |

---

## 4. Enrollment

| method / path | authorization | notes |
|---|---|---|
| `POST /children/:id/enrollments` | PARENT + `authorisedGuardian` | `{ schoolId, academicYearId, grade, classroomId?, privacyMode? }` → `student_school_enrollments` (ACTIVE, previous → COMPLETED) + `student_class_enrollments`. |
| `GET /children/:id/enrollments` | PARENT guardian · TEACHER (class-scoped: only the enrollment for a class they teach) | full history, never overwritten. |
| `POST /children/:id/enrollments/:eid/set-privacy-mode` | PARENT + `authorisedGuardian` | `{ privacyMode }`; downgrading revokes now-out-of-scope grants. |
| `GET /children/:id/enrollment-transitions` | PARENT guardian | PROPOSED + CONFIRMED transitions. |
| `POST /children/:id/enrollment-transitions/:tid/confirm` | PARENT + `authorisedGuardian` | body = overrides (`toSchoolId?`, `toClassroomId?` / `suggestedClassName?`, `toGrade?` for repeat/correction). Applies doc 24 §3. |
| `POST /children/:id/enrollment-transitions` | PARENT guardian · TEACHER (`CLASS_TEACHER`, `proposed_by=TEACHER`, still needs guardian confirm) | manual `CLASS_CHANGE` / `SCHOOL_TRANSFER` / `REPEAT_GRADE` / `MANUAL_CORRECTION`. |

---

## 5. Relationship requests (both directions — spec §5)

| method / path | authorization | notes |
|---|---|---|
| `POST /relationship-requests` | PARENT: `authorisedGuardian` of `target_child_id` · TEACHER: any (creates PENDING, **zero access**) | `{ relationshipKind, targetType, targetChildId?/targetUserId?, relationshipType, subjectId, accessSource, proposedPermissions[], discoveryMethod, inviteCode?/parentEmail?, message? }`. Idempotent via partial-unique. |
| `GET /relationship-requests/inbox` | authenticated | requests where the caller is the required responder (spec §4). |
| `GET /relationship-requests/outbox` | authenticated | requests the caller sent. |
| `POST /relationship-requests/:id/accept` | **required responder** — for a Teacher→Child request: `authorisedGuardian` of the child (R-2) | `{ approvedPermissions[] }` (⊆ proposed). Creates/activates `teacher_child_links` / `teacher_parent_links` + `permission_grants`. Cancels superseding pending requests. |
| `POST /relationship-requests/:id/reject` | required responder | reason optional. |
| `POST /relationship-requests/:id/cancel` | requester, while PENDING | |
| `POST /relationships/:linkId/revoke` | PARENT + `authorisedGuardian` (child link) · either party (parent link) | future access stops immediately; history retained (R-6). |
| `POST /relationships/:linkId/permissions` | PARENT + `authorisedGuardian` | grant/revoke individual `permission_grants` on an existing ACCEPTED link. |
| `GET /children/:id/relationships` | PARENT guardian | all teacher links + their effective permissions + access sources. |

### 5.1 Teacher-initiated child request — the ZERO-access invariant (R-2)

```
POST /relationship-requests { relationshipKind: TEACHER_CHILD, requester_role: TEACHER, ... }
  → row status = PENDING, accepted_by_parent_user_id = NULL
  → NO teacher_child_links row, NO permission_grants
  → the teacher's GET /children/:id  →  403  (can(...) finds no ACTIVE link)
  → audit_events: RELATIONSHIP_REQUEST_CREATED

POST /relationship-requests/:id/accept   (by authorisedGuardian ONLY)
  → teacher_child_links (ACCEPTED, accepted_by_parent_user_id set)
  → permission_grants for approvedPermissions
  → audit_events: RELATIONSHIP_REQUEST_ACCEPTED
```

Any attempt by the teacher to `accept` their own request → `403`.

---

## 6. Teacher

| method / path | authorization | notes |
|---|---|---|
| `GET /teacher/classes` | TEACHER | own `teacher_class_assignments`. |
| `POST /teacher/school-memberships` / `class-assignments` | TEACHER (self-declared) | `verification_status = SELF_DECLARED`; a school/parent may upgrade it. |
| `GET /teacher/children/:childId/permissions` | TEACHER + any ACTIVE link with the child | returns the caller's effective `can(...)` codes per subject — the teacher's own capability view. |
| `POST /teacher/children/:childId/contributions` | TEACHER + `can(SUBMIT_<type>, subject, now)` — **subject-scoped** | `{ subjectId, contributionType, payload, observedAt, confidence?, visibility?, attachmentId? }` → `teacher_learning_contributions` (append-only, provenance = the link/assignment id) → Resolver. **Never** writes the Twin directly (R-7). A cross-subject write → `403`. |
| `POST /teacher/children/:childId/assignments` | TEACHER + `can(CREATE_ASSIGNMENT, subject, now)` | creates a DạyZi practice assignment for the child (goes through the normal spec→generate→validate pipeline; delivered to the child only in a non-SHADOW future). |
| `GET /teacher/children/:childId/twin-summary` | TEACHER + `can(VIEW_LEARNING_TWIN_SUMMARY, subject, now)` (sensitive, default OFF) | a **redacted** summary — teacher-selected skills, no raw evidence, no behaviour notes. |

---

## 7. Learning (existing, now relationship-aware)

| method / path | authorization change |
|---|---|
| `GET /children/:id/learning-context` | PARENT guardian · TEACHER `can(VIEW_CLASS_CONTEXT)` gets **class-context only** (current lesson / exam window), not the resolved private context · STUDENT: not exposed (unchanged). |
| `GET /children/:id/today` | STUDENT `childScope==id` (child-safe, unchanged) · PARENT guardian · TEACHER: only if `can(VIEW_ASSIGNMENT_COMPLETION)` and then completion status only. |
| `POST /children/:id/evidence` | PARENT guardian · TEACHER → **routed to `/teacher/.../contributions`** (a teacher cannot post raw `evidence`; only `teacher_learning_contributions`). |
| `POST /children/:id/confirm-lesson` | PARENT guardian · TEACHER `can(SUBMIT_CURRENT_LESSON, subject)` — becomes a `LessonConfirmationEvent` with `source=TEACHER_UPDATE` + `relationship_source_id` (doc 13 unchanged). |

---

## 8. Per-endpoint authorization policy (child-facing summary)

| endpoint | PARENT | STUDENT | TEACHER | ADMIN |
|---|---|---|---|---|
| `GET /children/:id` | `authorisedGuardian` | `childScope==id` + child-safe | `can(any granted, subject)` → filtered view | ✗ |
| `GET /children/:id/today` | guardian | `childScope==id` + child-safe | `can(VIEW_ASSIGNMENT_COMPLETION)` | ✗ |
| `GET /children/:id/learning-context` | guardian (full) | ✗ | `can(VIEW_CLASS_CONTEXT)` → class context only | ✗ |
| `GET /children/:id/twin-summary` | guardian (full) | ✗ | `can(VIEW_LEARNING_TWIN_SUMMARY)` → redacted (default OFF) | ✗ |
| `POST /teacher/children/:id/contributions` | ✗ (parents use `/evidence`) | ✗ | `can(SUBMIT_<type>, subject)` | ✗ |
| `POST /children/:id/enrollments*` | `authorisedGuardian` | ✗ | propose only, guardian confirms | ✗ |
| `POST /relationship-requests/:id/accept` (Teacher→Child) | `authorisedGuardian` | ✗ | ✗ (never own request) | ✗ |

**No endpoint returns child-data on UI-trust alone** — the check is server-side
and the golden tests (doc 26 §50–54) assert it.

---

## 9. Resolved decisions (API) — anh 2026-09-02

1. **ID-Q10 — direct Parent evidence path KEPT.** `POST /children/:id/evidence`
   stays for guardians (they are the owner). Every row carries actor / provenance
   (`PARENT_DIRECT`) / source / `subject_id`, and enters the normal
   `Evidence → Resolver / Gap / Twin` pipeline — no Twin bypass (doc 21 §12.4).
   Only teachers are routed through `teacher_learning_contributions`.
2. **`GET /me/children` for teachers** — class-join list shows only
   `allow_teacher_discovery_by_class_join = true` children whose PRIMARY class
   `privacy_mode != PRIVATE_LEARNING`; display name + class only. Confirmed.
3. **Rate limiting** on `/schools/search` and `/relationship-requests` — designed
   in I7 (noted here).
4. **Contribution endpoint** — enforces the CLASS_CONTEXT_WRITE /
   CHILD_SPECIFIC_WRITE split (§0, doc 21 §3.1).
