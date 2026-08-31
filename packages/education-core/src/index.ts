/**
 * @copilot/education-core — deterministic education engine.
 *
 * Everything here is a PURE function over evidence + rules (no I/O, no AI, no framework)
 * so it can be exhaustively golden-tested. The deterministic core owns curriculum,
 * prerequisites, mastery/gap/readiness transitions — the LLM never mutates these.
 *
 * Phase 0 ships the prerequisite-graph invariant; mastery/gap/readiness engines
 * arrive in Phases 3–4 behind their golden tests.
 */
export * from './prerequisite-graph.js';
