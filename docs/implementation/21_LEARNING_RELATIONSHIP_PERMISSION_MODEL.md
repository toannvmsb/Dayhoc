# 21 — Learning Relationship & Permission Model

> **Authority:** locked spec §5, §6, §7, §13, §15. Companion: [19](19_IDENTITY_FAMILY_MODEL.md),
> [20](20_SCHOOL_CLASS_ENROLLMENT_MODEL.md), [22](22_AUTH_AND_WORKSPACE_ARCHITECTURE.md).
> **Status:** SPEC ONLY.

---

## 0. Locked invariants

| # | Invariant |
|---|---|
| R-1 | Relationships may be initiated by **BOTH** Parent and Teacher. |
| R-2 | A **teacher-initiated** Child request grants **ZERO** child learning-data access until an **authorised guardian** ACCEPTs. A teacher can never self-activate a Teacher–Child relationship. |
| R-3 | Teacher–School, Teacher–Class, Teacher–Parent, Teacher–Child are **independent**. One is never inferred from another; converting one into child-data access requires an explicit scoped grant. |
| R-4 | **Relationship ≠ data sharing.** All access is via scoped permissions. Class membership ≠ Learning Twin sharing. |
| R-5 | Sensitive permissions (`VIEW_SELECTED_GAPS`, `VIEW_LEARNING_TWIN_SUMMARY`) default **OFF**. |
| R-6 | **Revoke takes effect immediately** for future access. Historical contributions/evidence are NOT deleted on revoke (retention is a separate privacy-policy concern). |
| R-7 | Teacher input never mutates the Twin directly — it becomes `teacher_learning_contributions` → `evidence` → Resolver (preserve doc 13). |
| R-8 | Every accept / reject / revoke / permission change is **audited**. |
| R-9 | Effective permission = union of active grants, **then** gated by privacy mode + consent policy (the higher-level gate always wins). |
| R-10 | **CLASS_CONTEXT_WRITE ≠ CHILD_SPECIFIC_WRITE (FINAL DECISION, anh 2026-09-02).** `LINKED_SHARED` does **not** mean every Teacher assigned to the classroom may write arbitrary Child-specific data. Class-context contributions may be derived from an ACTIVE Teacher–Class–Subject assignment; child-specific contributions **always** require an explicit per-Child grant. See §3.1. |
| R-11 | **Legacy `teacher_invites` migrate to `LEGACY_MINIMAL` only (ID-Q3).** An accepted invite never auto-grants a sensitive Twin/gap permission — those need fresh Parent consent. See §12. |

---

## 1. Current-state audit

| Concept | Today | Verdict |
|---|---|---|
| Teacher↔child link | `teacher_invites(family_id, child_id, teacher_id?, class_ref, status IN {pending,accepted,revoked}, invited_by)` | **DEPRECATE** — parent-initiated only, no permissions, no subject, no teacher-initiated, no expiry, no audit trail beyond `status`. |
| Teacher↔parent link | none | ADD |
| Permission model | `services/api` `requireChildAccess`: teacher is authorised iff `familyUserIds.includes(userId)` — **binary, family-wide** | REPLACE with scoped `permission_sets` / `permission_grants` + ABAC. |
| Teacher contribution | `teacher_contributions(child_id, contributed_as IN {teacher,parent}, actor_user_id text, taught_skill_ids jsonb, problem_type_ids jsonb, homework_refs jsonb, exam_ref jsonb)` append-only; feeds `resolveLearningContext` via `TeacherContribution` domain type | **EXTEND** — this is the right shape (R-7 already holds). Add `subject_id`, `relationship_source_type/id`, `contribution_type`, `confidence`, `visibility`. |
| Consent | `consent_records(child_id, granted_by, data_categories, purpose, processor, …)` | REUSE. |
| Privacy preferences | none (only per-processing-purpose `consent_records`) | ADD `privacy_preferences`. |

---

## 2. Relationship entities

```
relationship_requests   ── the audited workflow object (both directions)
      │  on ACCEPT →
      ├──► teacher_child_links     (+ permission_set)
      └──► teacher_parent_links    (+ permission_set)

permission_sets   ── a named bundle of permission codes (a proposal / a granted set)
permission_grants ── an active (relationship → permission code → access source) tuple
```

### 2.1 `relationship_requests`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `requester_user_id` | uuid → users | |
| `requester_role` | text | `PARENT | TEACHER` |
| `target_type` | text | `PARENT | CHILD | TEACHER` |
| `target_user_id` | uuid → users nullable | resolved target identity (may be null until sign-up) |
| `target_child_id` | uuid → children nullable | set when `target_type = CHILD` |
| `relationship_kind` | text | `TEACHER_CHILD | TEACHER_PARENT` |
| `relationship_type` | text | `CLASS_TEACHER | SUBJECT_TEACHER | PRIVATE_TUTOR | COACH | MENTOR | OTHER` |
| `subject_id` | uuid → subjects nullable | |
| `access_source` | text | `PARENT_DIRECT | CLASS_ASSIGNMENT` (how the resulting grant is scoped) |
| `proposed_permissions` | jsonb | array of permission codes the requester proposes |
| `message` | text nullable | |
| `discovery_method` | text | `INVITE_CODE | PARENT_LINK | CLASS_JOIN | EMAIL_LOOKUP | QR` (doc §10) |
| `status` | text | `PENDING | ACCEPTED | REJECTED | EXPIRED | CANCELLED` |
| `expires_at` | timestamptz | default now()+14d |
| `responded_by_user_id` | uuid → users nullable | |
| `responded_at` | timestamptz nullable | |
| `approved_permissions` | jsonb nullable | subset the responder actually granted (≤ proposed) |
| `created_at` | timestamptz | |
| partial unique | `(requester_user_id, target_child_id, relationship_kind, subject_id)` where `status='PENDING'` | idempotency — one pending request per (requester, child, kind, subject) |

### 2.2 `teacher_child_links`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `teacher_user_id` | uuid → users | |
| `child_id` | uuid → children | |
| `subject_id` | uuid → subjects nullable | (null = all subjects — discouraged; UI defaults to a subject) |
| `relationship_type` | text | as above |
| `access_source` | text | `PARENT_DIRECT | CLASS_ASSIGNMENT` |
| `access_source_id` | uuid nullable | → `teacher_class_assignments.id` when `CLASS_ASSIGNMENT` |
| `initiated_by_role` | text | `PARENT | TEACHER` |
| `initiated_by_user_id` | uuid → users | |
| `origin_request_id` | uuid → relationship_requests | |
| `status` | text | `PENDING | ACCEPTED | REJECTED | REVOKED | EXPIRED` |
| `permission_set_id` | uuid → permission_sets | the *active* set |
| `valid_from`, `valid_until` | timestamptz nullable | |
| `accepted_by_parent_user_id` | uuid → users nullable | the authorised guardian who accepted (R-2) |
| `accepted_at`, `rejected_at`, `revoked_at` | timestamptz nullable | |
| `created_at` | timestamptz | |
| partial unique | `(teacher_user_id, child_id, subject_id, access_source)` where `status IN ('PENDING','ACCEPTED')` | |

**R-2 enforced by a CHECK-like rule at the service layer + DB:** a
`teacher_child_links` row may only be `status='ACCEPTED'` if
`accepted_by_parent_user_id IS NOT NULL` **and** that user is an authorised
guardian of `child_id` at `accepted_at`. A teacher-initiated row is created
`PENDING` with `accepted_by_parent_user_id = NULL`; the teacher cannot patch it.

### 2.3 `teacher_parent_links`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `teacher_user_id` | uuid → users | |
| `parent_user_id` | uuid → users | |
| `child_id` | uuid → children nullable | optional context |
| `subject_id` | uuid → subjects nullable | |
| `purpose` | text | `COMMUNICATION | LEARNING_UPDATE | ASSIGNMENT_COORDINATION | EXAM_COMMUNICATION | PARENT_GUIDANCE` |
| `initiated_by_role`, `initiated_by_user_id`, `origin_request_id` | | |
| `status` | text | `PENDING | ACCEPTED | REJECTED | REVOKED | EXPIRED` |
| `permission_set_id` | uuid → permission_sets | (typically just `MESSAGE_PARENT`) |
| `accepted_by_user_id`, `accepted_at`, `revoked_at`, `created_at` | | |

**R-3:** a `teacher_parent_links` ACCEPTED row grants **no** `child_id` learning
access. Messaging only. A Teacher–Child grant needs its own
`relationship_requests` → `teacher_child_links` flow.

### 2.4 `permission_sets` / `permission_grants`

`permission_sets(id PK, name, kind ['PROPOSED_TEMPLATE'|'ACTIVE'], owner_scope ['teacher_child_link'|'teacher_parent_link'], codes jsonb, created_by, created_at)`

`permission_grants`:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `subject_link_type` | text | `TEACHER_CHILD | TEACHER_PARENT` |
| `subject_link_id` | uuid | → the link row |
| `permission_code` | text | see §3 |
| `subject_id` | uuid → subjects nullable | |
| `access_source` | text | `PARENT_DIRECT | CLASS_ASSIGNMENT | SCHOOL_AUTHORIZATION` |
| `granted_by_user_id` | uuid → users | authorised guardian |
| `status` | text | `ACTIVE | REVOKED` |
| `granted_at`, `revoked_at` | timestamptz | |
| unique | `(subject_link_id, permission_code, subject_id, access_source)` where `status='ACTIVE'` | |

The **effective permission check** (`can(teacherUserId, childId, code, subjectId, asOf)`)
is a single server-side function:

```
1. find ACTIVE teacher_child_links for (teacher, child) [any subject or matching subject]
2. collect ACTIVE permission_grants for those links matching (code, subject)
3. if none → DENY
4. if code ∈ CHILD_SPECIFIC_WRITE and every matching grant has
   access_source='CLASS_ASSIGNMENT' → DENY   (R-10 / §3.1 — child-specific needs PARENT_DIRECT)
5. if the only matching access_source is CLASS_ASSIGNMENT:
   5a. require an ACTIVE teacher_class_assignments(teacher, classroom, subject)
   5b. require the child's ACTIVE PRIMARY student_class_enrollments in that classroom
   5c. require that class enrollment privacy_mode = LINKED_SHARED
       (VIEW_* Twin/gap codes are never class-derivable regardless — §3.1)
6. gate by consent_records / privacy_preferences — a withdrawn consent for the
   relevant data_category → DENY
7. else → ALLOW
```

---

## 3. Permission matrix

| code | category | default | who grants | notes |
|---|---|---|---|---|
| `VIEW_CLASS_CONTEXT` | class | ON for `LINKED_*` | class enrollment | current lesson / exam notice / homework topic — **no per-child Twin data** |
| `SUBMIT_CURRENT_LESSON` | contribution | OFF | guardian (`PARENT_DIRECT`) or class (`CLASS_ASSIGNMENT`) | teacher reports what the class is on |
| `SUBMIT_CURRICULUM_PROGRESS` | contribution | OFF | guardian/class | |
| `SUBMIT_HOMEWORK` | contribution | OFF | guardian/class | |
| `SUBMIT_TEST_RESULT` | contribution | OFF | guardian | per-child assessment result |
| `SUBMIT_EXAM_NOTICE` | contribution | OFF | guardian/class | |
| `SUBMIT_EXAM_SCOPE` | contribution | OFF | guardian/class | |
| `SUBMIT_SKILL_ASSESSMENT` | contribution | OFF | guardian | |
| `SUBMIT_LEARNING_OBSERVATION` | contribution | OFF | guardian | strength/weakness/behaviour |
| `CREATE_ASSIGNMENT` | action | OFF | guardian | teacher assigns DạyZi practice to the child |
| `VIEW_ASSIGNMENT_COMPLETION` | read | OFF | guardian | completion %, not answers |
| `VIEW_SELECTED_MASTERY` | read | OFF | guardian | mastery for teacher-selected skills only |
| `VIEW_SELECTED_GAPS` | **sensitive read** | **OFF** (R-5) | guardian only | |
| `VIEW_LEARNING_TWIN_SUMMARY` | **sensitive read** | **OFF** (R-5) | guardian only | |
| `MESSAGE_PARENT` | comms | ON for accepted `teacher_parent_links` | guardian | |

**Access sources:** `CLASS_ASSIGNMENT` can only ever grant the *contribution* +
`VIEW_CLASS_CONTEXT` + `VIEW_ASSIGNMENT_COMPLETION` codes, and only when the
child's class `privacy_mode = LINKED_SHARED`. All `VIEW_*` Twin/gap codes require
`PARENT_DIRECT` (an explicit guardian grant on a `teacher_child_links` row).
`SCHOOL_AUTHORIZATION` is reserved (future) and grants nothing today.

### 3.1 CLASS_CONTEXT_WRITE vs CHILD_SPECIFIC_WRITE (Amendment 3 — FINAL, anh 2026-09-02)

Contribution permission codes split into two write classes:

| write class | codes | may be derived from a Teacher–Class assignment? |
|---|---|---|
| **CLASS_CONTEXT_WRITE** | `SUBMIT_CURRENT_LESSON`, `SUBMIT_CURRICULUM_PROGRESS`, `SUBMIT_HOMEWORK`, `SUBMIT_EXAM_NOTICE`, `SUBMIT_EXAM_SCOPE` | **yes** — from an ACTIVE Teacher–Class–Subject assignment + `LINKED_SHARED`, where the guardian's permission policy explicitly allows class-derived contribution |
| **CHILD_SPECIFIC_WRITE** | `SUBMIT_SKILL_ASSESSMENT`, `SUBMIT_LEARNING_OBSERVATION`, `BEHAVIOUR_OBSERVATION`, individual identifying `SUBMIT_TEST_RESULT` | **no** — always needs an explicit per-Child `PARENT_DIRECT` grant on a `teacher_child_links` row |

**Class-derived (CLASS_CONTEXT_WRITE via `CLASS_ASSIGNMENT`) access is effective
only when ALL SIX hold:**

1. the Teacher–Class assignment is `ACTIVE` (`teacher_class_assignments.status='ACTIVE'`);
2. the Teacher's assignment `subject_id` matches the contribution `subject_id`;
3. the Child has an `ACTIVE` **PRIMARY** class enrollment in that classroom
   (`student_class_enrollments.status='ACTIVE' AND enrollment_type='PRIMARY'`) —
   *(a supplementary-class assignment grants class-context write for that
   supplementary class's context only, never the Child's primary curriculum
   context)*;
4. the Child's class `privacy_mode = LINKED_SHARED`;
5. the guardian's permission policy for that link/source allows the code
   (`permission_grants` row with `access_source='CLASS_ASSIGNMENT'`);
6. every consent / `privacy_preferences` gate for the code's data category allows it.

Failing **any** condition → the class-derived path yields nothing; the Teacher can
still contribute if a separate `PARENT_DIRECT` grant exists. **No classroom
assignment — primary or supplementary — ever grants a sensitive Twin read
(`VIEW_SELECTED_GAPS`, `VIEW_LEARNING_TWIN_SUMMARY`).** Those are `PARENT_DIRECT`,
guardian-granted, default OFF, forever.

`can(teacher, child, code, subject, asOf)` (§2 step 4) is extended: if `code ∈
CHILD_SPECIFIC_WRITE` and the only matching grant has
`access_source='CLASS_ASSIGNMENT'` → **DENY**.

---

## 4. Relationship request state machine (spec §13.1)

```
                    ┌── reject (by required responder) ──► REJECTED
PENDING ────────────┼── timeout (expires_at) ────────────► EXPIRED
   │                └── cancel (by requester, still PENDING) ► CANCELLED
   │
   └── accept (by required responder) ──► ACCEPTED ──► (creates/activates link)
                                              │
                                              └── revoke (authorised guardian) ──► link REVOKED
```

**Required responder:**
- Parent-initiated Teacher–Child / Teacher–Parent request → **Teacher** accepts.
- Teacher-initiated Teacher–Child request → **authorised guardian** accepts (R-2).
- Teacher-initiated Teacher–Parent request → **that parent** accepts.

### 4.1 Concurrency / idempotency (spec §5.5, prompt)

| scenario | rule |
|---|---|
| duplicate PENDING request (same requester, child, kind, subject) | partial-unique index rejects the 2nd insert → API returns the existing request (idempotent). |
| Parent and Teacher send a request to each other for the same (teacher, child, subject) simultaneously | both inserts succeed (different `requester_user_id`); the **first ACCEPT wins** and creates the link; the second request is auto-transitioned to `CANCELLED` with reason `SUPERSEDED_BY_EXISTING_LINK` by the accept handler (which checks for an ACTIVE link before creating). |
| repeated ACCEPT on an already-ACCEPTED request | idempotent no-op; returns the link. |
| ACCEPT after REJECT / EXPIRED / CANCELLED | rejected with `409 REQUEST_NOT_PENDING`. |
| expired request then resend | new `relationship_requests` row (the old one is `EXPIRED`, not blocking the partial-unique index). |
| multiple guardians | any authorised guardian may ACCEPT; the acceptance records `accepted_by_parent_user_id`; other guardians see it in an audit feed and may REVOKE. |
| teacher has both CLASS and PARENT_DIRECT grants | two `teacher_child_links` rows (different `access_source`) OR one link with `permission_grants` from two sources. Effective permission = union. |
| guardian revokes PARENT_DIRECT while CLASS remains | revoke only the `PARENT_DIRECT` `permission_grants` / link; the `CLASS_ASSIGNMENT` grants stay; `can(...)` recomputes → teacher keeps only the class-scoped codes. |
| every transition | writes an `audit_events` row (doc 22 §6). |

---

## 5. Privacy modes (per `student_class_enrollments.privacy_mode`)

| mode | class context to child? | teacher sees Twin? | teacher may contribute? |
|---|---|---|---|
| `PRIVATE_LEARNING` | **no** — fully parent-managed | no | no (no class link exists) |
| `LINKED_PRIVATE` | **yes** — current lesson, exam notice/scope, homework topic (as `VIEW_CLASS_CONTEXT` evidence) | **no** | only if a separate `PARENT_DIRECT` `teacher_child_links` exists |
| `LINKED_SHARED` | yes | only the **explicitly** granted `VIEW_*` codes | class-scoped contribution codes allowed |

Changing a privacy mode is an **authorised-guardian** action; downgrading
(`LINKED_SHARED → LINKED_PRIVATE → PRIVATE_LEARNING`) immediately revokes the
now-out-of-scope `permission_grants`.

---

## 6. Access-source composition (R-3, R-9)

```
effectiveCodes(teacher, child, subject, asOf) =
    Σ  ACTIVE permission_grants
       over ACTIVE teacher_child_links (teacher, child)
       where grant.subject matches (subject or null)
    ── minus codes not allowed for the grant's access_source
    ── minus CHILD_SPECIFIC_WRITE codes whose only source is CLASS_ASSIGNMENT (R-10)
    ── minus class-derived CLASS_CONTEXT_WRITE codes unless all six §3.1 conditions hold
    ── minus VIEW_* Twin codes if the child's ACTIVE PRIMARY class privacy_mode != LINKED_SHARED
       and the only source is CLASS_ASSIGNMENT
    ── minus VIEW_SELECTED_GAPS / VIEW_LEARNING_TWIN_SUMMARY whenever the only source
       is CLASS_ASSIGNMENT (never class-derivable — §3.1)
    ── minus codes whose data_category has a withdrawn consent_record
```

There is **no** "teacher_can_view_child" boolean anywhere. The check is always
`can(teacher, child, CODE, subject, asOf)`.

---

## 7. Teacher learning contribution (R-7 — EXTEND existing table)

`teacher_contributions` → renamed conceptually to **`teacher_learning_contributions`**
(keep the table, add columns; a VIEW keeps the old name during migration):

| column | keep / add |
|---|---|
| `id`, `child_id`, `recorded_at` | KEEP |
| `contributed_as IN (teacher, parent)` | KEEP |
| `actor_user_id text` | KEEP → tighten to `teacher_user_id uuid → users` (nullable for legacy `parent` rows) |
| `taught_skill_ids`, `problem_type_ids`, `homework_refs`, `exam_ref` | KEEP → move under a generic `payload jsonb` (existing shapes preserved) |
| `occurred_on` / `observed_at` | KEEP (rename to `observed_at timestamptz`) |
| `subject_id uuid → subjects` | **ADD** (backfill MATH) |
| `contribution_type text` | **ADD** — `CURRENT_LESSON | CURRICULUM_PROGRESS | HOMEWORK | TEST_RESULT | EXAM_NOTICE | EXAM_SCOPE | SKILL_ASSESSMENT | LEARNING_OBSERVATION | STRENGTH | WEAKNESS | BEHAVIOUR_OBSERVATION | ASSIGNMENT | COMMENT` |
| `relationship_source_type text` | **ADD** — `TEACHER_CHILD_LINK | CLASS_ASSIGNMENT` |
| `relationship_source_id uuid` | **ADD** — the link / assignment id (provenance for the Resolver) |
| `confidence text` | **ADD** — `A | B | C | D` (feeds `evidenceConfidence` in the Resolver, doc 13) |
| `visibility text` | **ADD** — `PARENT_AND_CHILD | PARENT_ONLY` (a `BEHAVIOUR_OBSERVATION` may be parent-only) |
| `attachment_id uuid → uploads nullable` | **ADD** |

**Flow (unchanged architecture — doc 13):**

```
teacher input (permission-checked)
   → teacher_learning_contributions row (append-only, provenance)
   → mapped to a domain `TeacherContribution` / `LessonConfirmationEvent`
   → resolveLearningContext(...)  / runGapEngine(...) / buildLearningTwin(...)
   → learning_context_snapshots / twin state
```

The Resolver's guardrails A–F, `inGrade` filter, `nodeType` eligibility (C4.2)
and confidence weighting are **unchanged**. A teacher contribution is one more
weighted signal — **never** an authoritative overwrite (R-7, E-5).

---

## 8. `privacy_preferences` (ADD)

| column | type | notes |
|---|---|---|
| `child_id` | uuid PK → children | |
| `default_class_privacy_mode` | text | `PRIVATE_LEARNING` default |
| `allow_teacher_discovery_by_email` | boolean default false | |
| `allow_teacher_discovery_by_class_join` | boolean default true | |
| `share_behaviour_observations_with_child` | boolean default false | |
| `updated_by`, `updated_at` | | |

Sits *above* `permission_grants` in the gate (R-9): a preference toggle can
suppress an otherwise-valid grant.

---

## 9. Subject scoping (spec §9)

`(child_id, subject_id)` is the unit for: teacher permissions, teacher
contributions, learning context, assignments, evidence. MVP: everything is
`subject_id = MATH`. A `SUBJECT_TEACHER` for Vietnamese who somehow obtains a
grant scoped to `subject_id = VIETNAMESE` cannot read or write anything Math —
`can(...)` requires the subject to match. Cross-subject writes are rejected
(golden test 48 / spec §16.27).

---

## 10. Privacy-safe teacher discovery (spec §15.10)

**No teacher may search the child table by name / school / class / PII.**
Allowed discovery methods (all recorded in `relationship_requests.discovery_method`):

| method | how |
|---|---|
| `INVITE_CODE` | parent generates a short-lived, single-use code for a specific child; teacher enters it → a `relationship_requests` targeting that child. |
| `PARENT_LINK` | parent sends a deep link / QR that pre-fills the request; teacher just picks subject + proposes permissions. |
| `CLASS_JOIN` | teacher is `ACTIVE` in `teacher_class_assignments` for a classroom; the system lists *children whose guardians set `allow_teacher_discovery_by_class_join = true` and whose class `privacy_mode != PRIVATE_LEARNING`*, shown as **display name + class only**, never full PII, and only to that teacher. |
| `EMAIL_LOOKUP` | teacher enters a parent email; the system returns a **yes/no "an account exists"** and lets the teacher send a `teacher_parent_links` request — it never reveals children. Gated by `allow_teacher_discovery_by_email`. |
| `QR` | printed class QR → parent scans → parent-initiated flow. |

Child enumeration (listing children a teacher has no relationship with) is
impossible: every list endpoint is scoped by `teacher_class_assignments` +
guardian opt-in, and returns no PII beyond display name.

---

## 11. REUSE / EXTEND / ADD / DEPRECATE (relationship + permission)

| table | classification |
|---|---|
| `relationship_requests` | ADD |
| `teacher_child_links` | ADD (replaces `teacher_invites`) |
| `teacher_parent_links` | ADD |
| `permission_sets` | ADD |
| `permission_grants` | ADD |
| `privacy_preferences` | ADD |
| `teacher_contributions` | **EXTEND** → `teacher_learning_contributions` (+ subject/type/source/confidence/visibility) |
| `teacher_invites` | **DEPRECATE-LATER** (migrate `accepted` rows to a `PARENT_DIRECT` `teacher_child_links` with the `LEGACY_MINIMAL` permission set — §12.1) |
| `consent_records` | REUSE |
| `evidence`, `lesson_confirmations`, `learning_context_snapshots` | REUSE unchanged |

---

## 12. Resolved decisions (relationship/permission) — anh 2026-09-02

### 12.1 ID-Q3 — legacy `teacher_invites` migration → `LEGACY_MINIMAL`

An `accepted` invite migrates to a `teacher_child_links`
(`access_source='PARENT_DIRECT'`, `subject_id=MATH`, `status='ACCEPTED'`,
`initiated_by_role='PARENT'`) **only if the existing data supports the
relationship** (a resolvable `teacher_id` and `child_id`). Its permission set is
the frozen **`LEGACY_MINIMAL`** profile:

```
LEGACY_MINIMAL = { VIEW_CLASS_CONTEXT, SUBMIT_CURRENT_LESSON }
```

- **Never** includes `VIEW_SELECTED_GAPS`, `VIEW_SELECTED_MASTERY`,
  `VIEW_LEARNING_TWIN_SUMMARY`, `SUBMIT_SKILL_ASSESSMENT`,
  `SUBMIT_LEARNING_OBSERVATION`, `BEHAVIOUR_OBSERVATION` or any CHILD_SPECIFIC_WRITE
  code. Those require a fresh Parent grant through the normal request flow.
- The migration writes an `audit_events` `RELATIONSHIP_MIGRATED` row and flags the
  link `needs_guardian_review = true` so the Parent is prompted to confirm or
  extend it.
- `pending` invites → `relationship_requests(status='PENDING')`.
- `revoked` invites → `teacher_child_links(status='REVOKED')` (history only, no
  grants).

### 12.2 ID-Q5 — request expiry

`relationship_requests.expires_at` default = **now() + 14 days**, sourced from a
**config value** `RELATIONSHIP_REQUEST_EXPIRY_DAYS` (not a hard constant) so it is
tunable per environment. An expired request cannot be accepted; the requester
sends a new one (§4.1).

### 12.3 ID-Q6 — authorised-guardian for accept

Any guardian with `can_approve_teacher_relationships = true` (doc 19 §3.4) may
accept a Teacher→Child request; **first-to-act wins**; the acceptance records
`accepted_by_parent_user_id`; other guardians see it in `audit_events` and may
`revoke`. `is_legal_guardian` is **not** consulted as the predicate — the
capability flag is.

### 12.4 ID-Q10 — direct Parent evidence retained, with provenance

Parents keep the direct `POST /children/:id/evidence` path (they are the owner).
Every such row now carries `actor_user_id`, `provenance='PARENT_DIRECT'`,
`source='PARENT_INPUT'`, and a `subject_id` where applicable. It enters the
**normal** `Evidence → LearningContextResolver / GapEngine / Twin` pipeline — it
**must not** bypass the Resolver or mutate the Twin directly (R-7 applies to
parents too). Only *teachers* are additionally constrained to
`teacher_learning_contributions` (§7).

### 12.5 Deferred (not blocking)

- **`MESSAGE_PARENT` content / message store** — messaging is out of scope for
  this phase; the permission code + `teacher_parent_links` table are designed, the
  message store is a later doc.
