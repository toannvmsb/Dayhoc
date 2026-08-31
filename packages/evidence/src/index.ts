/**
 * @copilot/evidence — the append-only evidence ledger (Phase 2).
 *
 * Every observation about a child enters through `EvidenceService`; the ledger
 * exposes no update or delete. A correction is a new record. Parent, teacher,
 * manual, scan and assessment evidence all coexist in one ordered stream, from
 * which the Child Learning Twin (Phase 3+) is recomputed.
 *
 * The Postgres backend is at `@copilot/evidence/pg` (keeps `pg` out of the
 * default import graph for pure/test consumers).
 */
export * from './store.js';
export * from './service.js';
