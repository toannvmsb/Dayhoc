/**
 * @copilot/gap-engine — deterministic gap detection, root-gap diagnosis,
 * priority scoring, lifecycle, readiness and prescription (Phase 4).
 *
 * Pure functions over a Child Learning Twin + the evidence stream + the math
 * knowledge base. No I/O, no AI. Classifies each failure into ONE of the gap
 * taxonomy types (Math Core §19) with an explicit `ruledOut` list, traces the
 * root through the prerequisite DAG (§20), scores priority (§21), and never
 * closes a gap on a single correct answer (§22).
 *
 * Coefficients in DEFAULT_GAP_CONFIG / DEFAULT_READINESS_CONFIG are PROVISIONAL
 * and uncalibrated (Risk R3, Decision D5).
 */
export * from './config.js';
export * from './root-gap.js';
export * from './detect.js';
export * from './error-signature.js';
export * from './score.js';
export * from './lifecycle.js';
export * from './readiness.js';
export * from './prescription.js';
export * from './engine.js';
