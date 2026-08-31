/**
 * @copilot/learning-twin — the Child Learning Twin (Phase 3).
 *
 * Deterministic, fully recomputable derived state built from the append-only
 * evidence stream:
 *   - multi-signal skill mastery (correctness × hint dependency × reasoning ×
 *     retention × recurrence × evidence confidence — never raw accuracy)
 *   - problem-type mastery, kept separate from skill mastery
 *   - thinking profile, kept separate from knowledge mastery
 *   - per-domain Actual Learning Frontier — never a single global grade level
 *
 * Coefficients live in `DEFAULT_MASTERY_CONFIG` and are PROVISIONAL / uncalibrated
 * (Risk R3); every output carries a `confidence`. Gap detection is Phase 4 — not here.
 */
export * from './config.js';
export * from './signals.js';
export * from './twin.js';
export * from './recompute.js';
