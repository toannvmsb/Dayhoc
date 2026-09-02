/**
 * @copilot/learning-state — persistence for DERIVED learning state (Twin / gaps /
 * plan snapshots, keyed by `child_id`) and GENUINE student work (assignments /
 * attempts / answers, append-only). Migration group IX / F1 — docs 04 §4/§5.
 *
 * The append-only `evidence` stream remains the source of truth; every derived
 * row is rebuildable and `invalidateDerived` wipes it for a clean recompute.
 */
export * from './store.js';
