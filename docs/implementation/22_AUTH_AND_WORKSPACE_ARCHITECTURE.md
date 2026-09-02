# 22 — Auth & Workspace Architecture

> **Authority:** locked spec §1, §10, §14, §15. Companion: [19](19_IDENTITY_FAMILY_MODEL.md),
> [21](21_LEARNING_RELATIONSHIP_PERMISSION_MODEL.md), [25](25_IDENTITY_RELATIONSHIP_API_PLAN.md).
> **Status:** SPEC ONLY.

---

## 0. Locked invariants

| # | Invariant |
|---|---|
| A-1 | One auth identity → one `users` row → many roles (`user_roles`). |
| A-2 | The domain `users` / `user_roles` model must **not** be vendor-locked. Auth provider is swappable behind an adapter. |
| A-3 | Child-data authorization is checked **server-side** on every request. UI hiding is never sufficient (spec §15.7, §16.54). |
| A-4 | A request declares a **workspace** (`PARENT | STUDENT | TEACHER`); the API rejects any workspace the user does not hold. |
| A-5 | A Child with no login has **no** `users` row and **no** session — only `child_credentials` / `child_quick_access` keyed by `child_id`. |
| A-6 | **LOCKED (ID-Q1, anh 2026-09-02): Supabase Auth + Supabase Postgres for the MVP.** The domain stays behind the `AuthAdapter` port (A-2). Server-side `authorize()` / `can()` is the **primary** business authorization layer; Postgres/Supabase **RLS is defence-in-depth where practical, never the only business-authorization engine** (§7). |

---

## 1. Current-state audit

| Concept | Today |
|---|---|
| Auth implementation | **none** — no Supabase/JWT/session/password code in the repo. `services/api` `createApi(deps)` receives a trusted `RequestContext { userId, role, childScope? }`. |
| Role | single `Role` per `RequestContext`. |
| Child auth | tables exist (`child_credentials` username/password, `child_quick_access` PIN) but no verification code. |
| Projection | `@copilot/projections` `assertChildSafe` + child-safe view types — **this is solid and stays** (spec §15.7). |
| Docs | `03_SYSTEM_ARCHITECTURE.md` §"Auth": "Parent (email + password/OTP). Child = username+password created by parent. PIN = quick access, not a login. RBAC least-privilege + family scope." + `PRIVACY_ARCHITECTURE.md`. |

**Verdict:** the *projection* layer is correct. The *authentication* + *workspace*
+ *relationship-aware authorization* layers are unbuilt and must be designed now.

---

## 2. Layered model

```
┌─ AUTH (identity) ────────────────────────────────────────────────┐
│  Supabase Auth (or compatible)  →  auth_user_id, verified email  │
│  AuthAdapter port:  verifyToken(jwt) → { authUserId, email }     │
└─────────────────────────────────────────────────────────────────┘
              ▼  (resolve)
┌─ IDENTITY ──────────────────────────────────────────────────────┐
│  users (by auth_user_id)  →  user_roles                          │
│  parent_profiles / teacher_profiles / student_account_links      │
└─────────────────────────────────────────────────────────────────┘
              ▼  (client picks)
┌─ WORKSPACE ─────────────────────────────────────────────────────┐
│  RequestContext { userId, workspace: PARENT|STUDENT|TEACHER,     │
│                   childScope?  (STUDENT only) }                  │
│  must satisfy: workspace ∈ user_roles(userId)                    │
└─────────────────────────────────────────────────────────────────┘
              ▼  (per resource)
┌─ AUTHORIZATION (RBAC + relationship-aware ABAC) ────────────────┐
│  authorize(ctx, resource, action) — server-side, always         │
└─────────────────────────────────────────────────────────────────┘
              ▼
┌─ PROJECTION (unchanged) ───────────────────────────────────────┐
│  role/workspace-specific view + assertChildSafe                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. AuthAdapter port (A-2)

```ts
interface AuthAdapter {
  /** Verify a bearer token from the client; returns the provider identity. */
  verifyToken(bearer: string): Promise<{ authUserId: string; email?: string; phone?: string } | null>;
  /** Provider-side user creation (register). Returns authUserId. */
  createUser(input: { email?: string; phone?: string; password: string }): Promise<string>;
}
```

- **`SupabaseAuthAdapter`** — the pilot implementation (JWT verification against
  the Supabase JWKS; `createUser` via the Supabase admin API).
- **`InMemoryAuthAdapter`** — tests / local dev (deterministic, no network) —
  mirrors the existing test pattern (`InMemoryLedgerStore`, `MockLlmProvider`).
- **Passwords / OTP / magic-link never touch domain code.** The domain only ever
  sees `authUserId`. Swapping to Clerk / Auth0 / a self-hosted IdP = one adapter.

**Child login** does *not* use the AuthAdapter — it is a DạyZi-local
username/password (`child_credentials`, parent-created) verified by a
`ChildCredentialService` (argon2id hash), issuing a **child session** with
`workspace = STUDENT`, `childScope = child_id`, and a **narrow** capability set
(child-safe projection only). The 4-digit PIN (`child_quick_access`) issues an
even narrower session: *assigned work only*, no history, no settings.

---

## 4. Session & workspace

- Auth issues **one** session token (JWT) for the human identity.
- The client calls `GET /me/roles` → `{ userId, roles: [...], defaultWorkspace }`.
- The client calls `POST /me/switch-workspace { workspace }` → the API validates
  `workspace ∈ roles` and returns a **workspace-scoped access token** (short-lived,
  carries `{ userId, workspace }`). All subsequent calls send this token.
- `RequestContext` is derived server-side from the workspace token — the client
  never asserts its own `userId`/`role` (fixes the current trusted-input model).

| workspace | may reach |
|---|---|
| `PARENT` | children where `authorisedGuardian` or `ACTIVE parent_child_relationship`; family billing; relationship inbox; enrollment; privacy controls; parent analytics. |
| `STUDENT` (`childScope` set) | **only** child-safe projections for that one child (`assertChildSafe`). Never parent analytics / mastery / gaps / consent / billing. |
| `TEACHER` | children where `can(teacherUserId, childId, <code>, subject, now)` for the requested action; own class/school memberships; contribution endpoints; relationship inbox. |
| `ADMIN` | operational endpoints only; **no** bulk child-data export path. |

---

## 5. `authorize(ctx, resource, action)` — the single gate

```
authorize(ctx, resource, action):
  switch ctx.workspace:
    PARENT:
       resource is a child  → require authorisedGuardian(ctx.userId, child.id)
       resource is family    → require family_memberships(ctx.userId, family.id)
    STUDENT:
       require ctx.childScope == resource.child_id  AND  action ∈ CHILD_SAFE_ACTIONS
    TEACHER:
       resource is a child  → require can(ctx.userId, child.id, actionToPermissionCode(action), resource.subject_id, now)
       resource is a class  → require ACTIVE teacher_class_assignments(ctx.userId, class.id)
    ADMIN:
       action ∈ ADMIN_ACTIONS   (never a child-data read/export)
```

- **`authorisedGuardian(userId, childId, capability)`** — an `ACTIVE
  parent_child_relationships` row for `(userId, childId)` whose requested
  capability flag is true (`can_manage_child` / `can_manage_privacy` /
  `can_approve_teacher_relationships`, doc 19 §3.4). **`is_legal_guardian` is
  never the predicate** (ID-Q6). `guardianAuthority(userId, childId)` returns the
  OR-union of capabilities across that user's ACTIVE rows. R-2 acceptance needs
  `can_approve_teacher_relationships`; privacy-mode / sensitive-grant changes need
  `can_manage_privacy`; profile / enrollment / student-link changes need
  `can_manage_child`.
- **`can(...)`** — the effective-permission function from doc 21 §6.
- `actionToPermissionCode` maps e.g. `GET /children/:id/twin-summary` →
  `VIEW_LEARNING_TWIN_SUMMARY`.
- **Every child-facing endpoint** calls `authorize` before touching data. No
  handler reads `child_id` data without it.

---

## 6. `audit_events` (A-3, R-8) — ADD

| column | type |
|---|---|
| `id` | uuid PK |
| `actor_user_id` | uuid → users nullable |
| `actor_workspace` | text |
| `event_type` | text — `RELATIONSHIP_REQUEST_CREATED | ...ACCEPTED | ...REJECTED | ...REVOKED | PERMISSION_GRANTED | PERMISSION_REVOKED | PRIVACY_MODE_CHANGED | ENROLLMENT_TRANSITION_CONFIRMED | CHILD_DATA_ACCESS_DENIED | STUDENT_ACCOUNT_LINKED | ...` |
| `subject_type`, `subject_id` | text / uuid — the affected entity |
| `child_id` | uuid → children nullable |
| `payload` | jsonb — before/after, reason |
| `created_at` | timestamptz |
| append-only | DB trigger (reuse `reject_ledger_mutation` pattern) |

Every accept/reject/revoke/permission/privacy/enrollment transition and every
**denied** child-data access writes one row.

---

## 7. RLS strategy — Supabase Postgres LOCKED (ID-Q1)

The pilot uses Supabase-hosted Postgres. Row-Level Security is added as
**defence-in-depth only — the application `authorize()` / `can()` gate is the
primary and authoritative business-authorization control** (A-6). RLS is a
backstop for direct-connection mistakes, not a substitute for the domain check,
and a resource is never considered "protected" merely because an RLS policy
exists.

- `children`, `evidence`, twin/gap/plan tables: `USING` policy that joins to
  `parent_child_relationships` (capability-aware, doc 19 §3.4) /
  `teacher_child_links` + `permission_grants` for the `auth.uid()`.
- The API connects as a role that respects RLS for user-scoped reads, and as a
  privileged migration/service role for the append-only ledgers + the
  Progression Engine.
- Where an RLS policy would be complex or lossy (e.g. the six-condition
  class-derived write check, doc 21 §3.1), RLS stays coarse (deny-by-default,
  relationship-exists) and the precise decision is the application gate's job.
- RLS policies are **not** in scope for I1 — they land with I7 (auth cutover).
  Until then the application gate is the control and this is recorded as an
  accepted, time-boxed risk.

---

## 8. What is NOT changing

- `@copilot/projections` child-safe types + `assertChildSafe` — kept as-is.
- The append-only ledger triggers (`evidence`, `teacher_contributions`,
  `consent_records`, `generation_specs`, …).
- The C4/C5 generation pipeline and its `SHADOW` wiring in `services/api`
  `childToday` — unchanged; it already runs *after* the child projection is built.

---

## 9. Resolved decisions (auth/workspace) — anh 2026-09-02

1. **ID-Q1 — LOCKED: Supabase Auth + Supabase Postgres for the MVP.** Domain
   behind `AuthAdapter`. Application `authorize()` / `can()` primary; RLS
   defence-in-depth, not sole (§7, A-6). Adapter keeps a future IdP swap cheap.
2. **Workspace token vs claims** — separate **short-lived workspace token**
   (clean revocation, no claim-mutation). Confirmed.
3. **Child session lifetime** — 30 days for username/password (ends on parent
   password reset); PIN session 24h. Confirmed for pilot.
4. **ADMIN scope** — ADMIN has **zero** child-data read/export path; ops only
   (school verification, provider registry, cost dashboards). Confirmed.
5. **RLS timing** — RLS policies land with I7, not I1; until then the application
   gate is the only control (accepted time-boxed risk, §7).
