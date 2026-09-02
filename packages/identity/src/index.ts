/**
 * @copilot/identity — multi-role identity, household/family context, and the
 * capability-based guardian-authority model (migration group I1; docs 19, 22, 25).
 *
 * Locked scope (ID-Q8): identity / family / role / relationship / permission /
 * authorization domain logic lives here. Education-specific enrollment / curriculum
 * logic stays in the education/domain packages. No circular dependencies.
 *
 * Invariants:
 *  - Child ≠ User  — a Child Profile exists with no login; `child_id` never changes.
 *  - User ≠ Role   — roles are M:N; a workspace must be a role the user holds.
 *  - Guardian authority is an explicit capability set with provenance
 *    (`authority_source`); `is_legal_guardian` is a nullable hint, never the
 *    sole predicate.
 *
 * The Postgres backend + the legacy backfill are at `@copilot/identity/pg`.
 */
export * from './errors.js';
export * from './auth-adapter.js';
export * from './store.js';
export * from './guardian-authority.js';
export * from './identity-service.js';
export * from './family-service.js';
export * from './relationship-store.js';
export * from './class-context.js';
export * from './permission-service.js';
export * from './relationship-service.js';
export * from './authorization-service.js';
export * from './teacher-contribution-service.js';
