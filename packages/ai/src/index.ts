/**
 * @copilot/ai — replaceable LLM/Vision provider ports + the validate-and-record
 * orchestrator (Phase 10 hardening).
 *
 * The engine never sees raw model text: `AiOrchestrator.runStructured` calls the
 * provider, parses JSON, validates it against a versioned schema, and records
 * provenance + token/cost/latency to the observability sinks. Provider swap =
 * one class; nothing else changes. `MockLlmProvider` keeps golden tests and CI
 * fully deterministic.
 */
export * from './provider.js';
export * from './minimize.js';
export * from './orchestrator.js';
export * from './providers/mock.js';
