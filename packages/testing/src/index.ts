/**
 * @copilot/testing — golden educational test harness (Phase 4 → Phase 4.5 gate).
 *
 * Runs the deterministic pipeline (evidence → Child Learning Twin → gap engine)
 * with AI decoupled, and asserts outcomes within tolerance. The discrimination
 * matrix here proves the engine separates the 8 core gap types and keeps
 * Knowledge Level distinct from Thinking Level. The full `GT-G4-…` / `GT-G7-…`
 * registry is completed in Phase 4.5.
 */
export * from './harness.js';
export * from './golden/load.js';
export * from './golden/twin-planner-pipeline.js';
