/**
 * @copilot/domain — pure domain types & vocabulary.
 *
 * Encodes the NON-NEGOTIABLE education-model invariants as types:
 *  - grade-opaque Skill IDs (school_grade is context, not a ceiling),
 *  - two independent axes: Knowledge Level (K0–K5) vs Thinking Level (T1–T5),
 *  - append-only Evidence with a confidence hierarchy,
 *  - gap taxonomy + lifecycle (no close after a single correct answer).
 *
 * No I/O, no framework, no business logic here — just the shared vocabulary.
 */
export * from './identifiers.js';
export * from './taxonomy.js';
export * from './evidence.js';
export * from './gap.js';
export * from './roles.js';
export * from './context.js';
export * from './twin.js';
