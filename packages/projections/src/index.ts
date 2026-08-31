/**
 * @copilot/projections — pure functions from engine output to API view models.
 *
 * The parent projections carry the full picture; `buildChildToday` produces a
 * CHILD-SAFE projection whose sensitive fields are absent by construction, with
 * `assertChildSafe` as a runtime guard for the API boundary (Phase 6/7).
 */
export * from './shared.js';
export * from './parent.js';
export * from './child.js';
export * from './teacher.js';
