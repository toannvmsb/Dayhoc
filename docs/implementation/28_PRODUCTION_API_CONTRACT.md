# 28 — Production API Contract (I7.1)

> **Authority:** doc 22 (auth/workspace), doc 25 (endpoint design), I7.1 prompt.
> **Status:** IMPLEMENTED — `services/api` `createProductionApi(...)`. This is the
> surface the upcoming UI consumes. The legacy `createApi` (in-memory
> `childProfiles`, trusted `RequestContext`) is unit-test / fixture only and is
> **fail-closed in production**.

---

## 0. Request model

Every handler takes a **`CallerAuth`** first argument:

```ts
type CallerAuth =
  | { bearer: string; workspace: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN' }
  | { trusted: WorkspaceRequestContext };   // tests only — refused in production
```

Flow for the `bearer` form (the only production form):

```
Authorization: Bearer <jwt>
  → AuthAdapter.verifyToken()                (SupabaseAuthAdapter — HS256)
  → auth_user_id
  → users.id  (via users.auth_user_id)
  → user_roles  →  workspace ∈ held roles     (else 403)
  → STUDENT: childScope from the single ACTIVE student_account_links row
  → WorkspaceRequestContext { userId, workspace, childScope? }
```

The client can **never** supply an authoritative `userId`, `role`, `workspace`
it does not hold, `childScope`, guardian status, teacher-child relationship, or
permission grant. `trusted` contexts are honoured only when the API was built
with `allowTrustedContext: true`, which `trustedContextAllowed()` forces to
`false` whenever `NODE_ENV === 'production'`.

Every Child-data handler runs `AuthorizationService.authorize(ctx, {kind:'child',
childId, subjectId?}, action)` — RBAC (workspace) + relationship-aware ABAC
(guardian capability / `PermissionService.can()` / privacy mode / consent).
A denied Child read writes a `CHILD_DATA_ACCESS_DENIED` audit row.

Errors: `401` (`UnauthenticatedError`) · `403` (`ForbiddenError` /
`AuthzError` / `AuthorizationError`) · `404` (`NotFoundError`) · `409` (state
conflict) · `422` (validation).

---

## 1. Identity / workspace

| method | REST | auth | returns |
|---|---|---|---|
| `register(input)` | `POST /auth/register` | none | `{ userId, displayName, roles, profiles }` — `AuthAdapter.createUser` + `users` + role + profile. STUDENT self-register creates **no child**. |
| `getMe(auth)` | `GET /me` | authenticated | `{ userId, displayName, locale, roles, profiles:{parent?,teacher?} }` — no `auth_user_id`, no hashes. |
| `getMeRoles(auth)` | `GET /me/roles` | authenticated | `{ userId, roles[], defaultWorkspace }` |
| `switchWorkspace(bearer, workspace)` | `POST /me/switch-workspace` | `workspace ∈ roles` | `{ userId, workspace, childScope? }` — the **server-derived** context. |

## 2. Parent / child

| method | REST | authorize | returns |
|---|---|---|---|
| `listChildren(auth)` | `GET /children` | PARENT | `[{ childId, displayName, schoolGrade, dateOfBirth }]` — ACTIVE guardian rows only. |
| `createChild(auth, {displayName, schoolGrade, dateOfBirth?})` | `POST /children` | PARENT | child DTO. Tx: find/create billing family + `createChild` (creator = first guardian, all caps). |
| `getChild(auth, childId)` | `GET /children/:childId` | `authorize(view_child)` | PARENT: full DTO · TEACHER: `{ childId, displayName }` only. |
| `listGuardians(auth, childId)` | `GET /children/:childId/guardians` | `authorize(view_child)` | `[{ parentUserId, relationshipType, authoritySource, capabilities, status }]` |
| `listEnrollments(auth, childId)` | `GET /children/:childId/enrollments` | `authorize(view_child)` | `{ school[], class[], transitions[] }` — full history, never overwritten. |
| `createSchoolEnrollment(auth, childId, {schoolId, academicYearId, grade, calendarId?})` | `POST /children/:childId/enrollments/school` | `authorize(manage_child)` | school-enrollment record. Tx + `school_grade` cache sync. |
| `createClassEnrollment(auth, childId, {classroomId, academicYearId, enrollmentType?, privacyMode?, schoolEnrollmentId?})` | `POST /children/:childId/enrollments/class` | `authorize(manage_child)` | class-enrollment record. PRIMARY conflict → `409 PRIMARY_ENROLLMENT_EXISTS`. |
| `setClassPrivacy(auth, childId, classEnrollmentId, mode)` | `PATCH /children/:childId/class-enrollments/:id/privacy` | `authorize(set_privacy_mode)` → `can_manage_privacy` | updated record. Tx: downgrading `LINKED_SHARED` revokes now-out-of-scope `CLASS_ASSIGNMENT` grants + `PRIVACY_MODE_CHANGED` audit. |
| `getLearningContext(auth, childId)` | `GET /children/:childId/learning-context` | `authorize(view_learning_context)` | `{ expected, resolved, paceDelta, conflicts, calendar }` — DB-authorized, then the tested C4/C5 pipeline. |
| `getToday(auth, childId)` | `GET /children/:childId/today` | STUDENT `childScope==childId` (child-safe) · PARENT `authorize(view_child)` | `ChildTodayView` (`assertChildSafe`). |

## 3. School / class

| method | REST | notes |
|---|---|---|
| `searchSchools(auth, {nameFragment?, province?, district?})` | `GET /schools/search` | authenticated. **No Child data** in the response. |
| `proposeSchool(auth, {officialName, province?, district?, ward?, address?, schoolType?})` | `POST /schools/propose` | conservative de-dup — exact identity key merges, near-matches only surfaced in `similarCandidates`. |
| `listAcademicYears(auth)` | `GET /academic-years` | `[{ id, label, startDate, endDate, status }]` |
| `listSubjects(auth)` | `GET /subjects` | `[{ id, code, name, status }]` (MATH ACTIVE). |
| `listClasses(auth, schoolId, academicYearId)` | `GET /schools/:schoolId/classes` | `[{ id, grade, className, displayName, verificationStatus }]` |
| `proposeClass(auth, schoolId, {academicYearId, grade, className, displayName?})` | `POST /schools/:schoolId/classes/propose` | `{ id, className, deduplicated }` |

There is **no** endpoint that lists / searches children globally — no
enumeration.

## 4. Relationships

| method | REST | notes |
|---|---|---|
| `listRelationshipRequests(auth)` | `GET /relationship-requests` | `{ inbox[], outbox[] }` — minimal identity DTO. |
| `createRelationshipRequest(auth, input)` | `POST /relationship-requests` | `requesterRole` derived from workspace. PARENT must be an authorised guardian of the target child; TEACHER → PENDING, **ZERO access**. Idempotent. |
| `acceptRelationshipRequest(auth, id, approvedPermissions?)` | `POST /relationship-requests/:id/accept` | **Tx.** Teacher→Child: `can_approve_teacher_relationships`; teacher cannot accept own. Parent→Teacher: the teacher confirms. `approved ⊆ proposed`. |
| `rejectRelationshipRequest(auth, id)` | `POST /relationship-requests/:id/reject` | Tx. |
| `cancelRelationshipRequest(auth, id)` | `POST /relationship-requests/:id/cancel` | Tx. Requester only. |
| `revokeTeacherChildLink(auth, id)` | `POST /teacher-child-links/:id/revoke` | **Tx.** `can_manage_privacy`. Grants revoked immediately; link kept as history. |
| `listTeacherLinks(auth, childId)` | `GET /children/:childId/teacher-links` | `authorize(view_child)`. |
| `getTeacherLinkPermissions(auth, childId, linkId)` | `GET /children/:childId/teacher-links/:id/permissions` | `[{ code, accessSource }]` (ACTIVE grants). |
| `updateTeacherLinkPermissions(auth, childId, linkId, {grant?, revoke?})` | `PATCH /children/:childId/teacher-links/:id/permissions` | **Tx.** `authorize(grant_permission)` → `can_manage_privacy`. Only supported permission codes; subject scope preserved; every grant/revoke audited (`PERMISSION_GRANTED` / `PERMISSION_REVOKED`); revoke immediate. Sensitive codes (`VIEW_SELECTED_GAPS`, `VIEW_LEARNING_TWIN_SUMMARY`) require an explicit `grant`. |

## 5. Discovery (privacy-safe)

| method | REST | notes |
|---|---|---|
| `createInviteCode(auth, {childId, subjectId?, proposedPermissions?, ttlHours?, uses?})` | `POST /relationship-invite-codes` | `can_manage_child`. Sensitive codes stripped from the proposal. Returns `{ code, expiresAt, proposedPermissions }`. |
| `redeemInviteCode(auth, code)` | `POST /relationship-invite-codes/redeem` | TEACHER only → a PENDING Teacher–Child request. **ZERO access** until a guardian accepts. |
| `emailExists(auth, email)` | `POST /users/email-exists` | `{ accountExists: boolean }` — **never** any child information. |

## 6. Teacher

| method | REST | authorize |
|---|---|---|
| `teacherListChildren(auth)` | `GET /teacher/children` | ACCEPTED `teacher_child_links` → `[{ childId, displayName, subjectId }]` (display name + class only). |
| `teacherGetPermissions(auth, childId, subjectId?)` | `GET /teacher/children/:childId/permissions` | `{ codes: effectiveCodes(...) }` — the caller's own capability view. |
| `teacherSubmitContribution(auth, childId, input)` | `POST /teacher/children/:childId/contributions` | **Tx.** `can(SUBMIT_<type>, subject)` must ALLOW. Cross-subject → 403. Child-specific type → needs a PARENT_DIRECT grant. Records provenance; append-only; never mutates the Twin. |
| `teacherCreateAssignment(auth, childId, input)` | `POST /teacher/children/:childId/assignments` | `authorize(create_assignment)`. Currently returns 403 "LIVE generation is OFF" — the spec→generate→validate pipeline is unchanged (C4/C5). |
| `teacherGetTwinSummary(auth, childId, subjectId?)` | `GET /teacher/children/:childId/twin-summary` | `authorize(view_twin_summary)` → `can(VIEW_LEARNING_TWIN_SUMMARY)` **explicit grant** (default OFF, never class-derivable). Redacted: mastery band words only. |
| `teacherGetGaps(auth, childId, subjectId?)` | `GET /teacher/children/:childId/gaps` | `authorize(view_selected_gaps)` → `can(VIEW_SELECTED_GAPS)` **explicit grant** (default OFF, never class-derivable). `[{ skillId, type, lifecycleState }]` — no scores, no evidence. |

## 7. Student

| method | REST | notes |
|---|---|---|
| `studentGetMe(auth)` | `GET /student/me` | `childScope` resolved server-side from the ACTIVE `student_account_links`. `{ childId, displayName, schoolGrade }`. |
| `studentGetToday(auth)` | `GET /student/today` | uses the server-resolved `childScope`; `ChildTodayView` (`assertChildSafe`). |
| `studentGetAssignments(auth)` | `GET /student/assignments` | `{ assignments }` — child-safe projection. |

**The student never passes a `childId`** — there is no parameter to escape scope.
`getToday(studentAuth, otherChildId)` is rejected.

## 8. Data minimization (§11)

- No raw DB rows. Each DTO is workspace-shaped.
- Never exposed: `password_hash`, PIN hashes, `auth_user_id`, internal consent
  metadata, ungranted Twin/gap data, private evidence, unneeded guardian flags.
- School search: no Child fields. Email lookup: `{ accountExists }` only.
- Relationship request DTO: the minimum identity needed to act.

## 9. Transactions (§14)

`acceptRelationshipRequest`, `revokeTeacherChildLink`,
`updateTeacherLinkPermissions`, `setClassPrivacy`, `createSchoolEnrollment`,
`createClassEnrollment`, `createChild`, `teacherSubmitContribution`,
`confirmTransition` all run inside `withTransaction(pool, …)`. An authorization
decision never leaves partially-applied state.

## 10. Not in this contract

Messaging (`MESSAGE_PARENT` content), `class_cohorts`, LIVE AI worksheet
delivery, RLS policies, RS256/JWKS — all remain OPEN_DECISION (see
`PENDING_APPROVAL.md`).
