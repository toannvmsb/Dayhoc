# RLS decision (OD-1 → resolved for pilot)

## Architecture

**All production data access is server-mediated.** No client — web browser or
mobile app — ever opens a Postgres connection. Clients reach only the
application API:

- web → Next.js server actions + `/api/v1` route handlers
- mobile → `/api/v1` over HTTPS with a bearer token

The API is the single authorization gate: every child-data path calls
`authorize()` / `can()` (relationship-aware ABAC + workspace RBAC), covered by
the 30-item E2E security matrix and the M1/M3/M7 integration suites. The API
connects to Postgres with ONE privileged role:

- local / self-host: `postgres`
- Supabase: the **direct connection** string's `postgres` role, which carries
  `BYPASSRLS`

## Table-by-table

| Class | Tables | Decision |
|---|---|---|
| **A. child-scoped / personal / consent / audit** | users, families, child_profiles, evidence, skill_states, knowledge_gaps, assignments, attempts, uploads, upload_analysis, exams, teacher_child_links, permission_grants, consent_records, deletion_jobs, … (~55 tables) | **RLS ENABLED, deny-all (no policies)** — migration `1758153600000_rls_deny_by_default`. A leaked non-privileged credential reads nothing. The app (BYPASSRLS) is unaffected. |
| **B. static reference data** | schools, academic_years, subjects, classrooms, curriculum_calendars, ai_pricing_registry, ai_provider_registry | RLS left OFF — non-sensitive directory data; a read leak here is low impact and the app filters/authorizes at the query layer anyway. |
| **C. client-accessible tables** | *(none)* | There is deliberately no table a client may query directly. |

## Why not per-row `auth.uid()` policies

Row-level `USING (auth.uid() = ...)` policies only add value when a client
connects to Postgres *as* an end user (e.g. PostgREST with the `authenticated`
role and the user's JWT). DạyZi does not do that. Writing ~55 tables of
`auth.uid()` policies that the app path never exercises would be:

- untested against real traffic (the app bypasses them),
- a large new surface for subtle allow/deny bugs,
- duplicating the `authorize()` logic that is already the source of truth.

If a future feature exposes a table directly to a browser via PostgREST, that
table gets a real deny-by-default policy set at that time, designed and tested
for that path.

## Pilot posture

- `authorize()` / `can()` in the application layer — **authoritative**, tested.
- deny-all RLS on all personal/child tables — **defence in depth** against
  credential leakage.
- reference data — readable, non-sensitive.
