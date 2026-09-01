/**
 * @copilot/exercise-gen — the deterministic side of AI exercise generation
 * (doc 14 §6, C3 + C4). Contains the validator, the generator INTERFACE, a
 * deterministic grounding builder, a Mock generator (no network), and the
 * bounded orchestrator state machine. No live AI provider lives here.
 */
export * from './validator.js';
export * from './grounding.js';
export * from './generator.js';
export * from './mock-generator.js';
export * from './repair.js';
export * from './telemetry.js';
export * from './orchestrator.js';
export * from './persistence.js';
