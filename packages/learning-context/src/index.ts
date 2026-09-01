/**
 * @copilot/learning-context — assembles "what is the child learning right now"
 * from the evidence ledger (Phase 2).
 *
 * `buildLearningContext` is a pure, deterministic function over evidence +
 * (optional) teacher contributions + the math knowledge base. It always returns a
 * usable context — teacher participation is optional, never required.
 */
export * from './build.js';
export * from './resolver.js';
export * from './pace.js';
